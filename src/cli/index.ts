#!/usr/bin/env node --no-warnings --experimental-specifier-resolution=node --loader @esbuild-kit/esm-loader

import chalk from "chalk";
import * as commander from 'commander';
import { convertPathToLocal, createConfig, runPrismaCommand, usePrisma } from "./utils.js";
import MessageBuilder, { conflictTag, prismaCLITag, showIntro, successTag } from "./messages.js";
import PrismaParser from "./parser.js";
import { conflict, error, experimental, log, success, update, warn } from "./logger.js";
import ora from "ora";
import inquirer from "inquirer";
import { LIB_VERSION as current } from "../version.js";
import axios from "axios";
import * as fs from 'fs/promises';

// Requires node v14.7.0
const program = new commander.Command();

// Initialize the parser to have it ready when the subcommand is used
let parser: PrismaParser;
let configPath: string = "";
let createdConfiguration: boolean = false;

// Create the program instance and override the help menu
program
    .name('prisma-util')
    .description('Prisma Util is an easy tool that helps with merging schema files and running utility commands.')
    .configureHelp({
        formatHelp(cmd, helper) {
            showIntro();
            return "";
        }
    })
    .configureOutput({
        writeErr: (str) => { },
        outputError: (str, write) => { }
    })
    // Add sub command hook for creating the config file and reading from it
    .hook('preSubcommand', async (command, actionCommand) => {
        process.stdout.write(String.fromCharCode(27) + ']0;' + "Prisma Util" + String.fromCharCode(7));

        // Check version before continuing.
        try {
            const latest = (await axios.get("https://registry.npmjs.com/prisma-util")).data["dist-tags"].latest;
            const [major, minor, patch] = latest.split(".").map((num: string) => Number.parseInt(num));
            const [majorCurrent, minorCurrent, patchCurrent] = current.split(".").map((num: string) => Number.parseInt(num));

            const development = process.env.ENV == "dev";
            if(!development && (major > majorCurrent || minor > minorCurrent || patch > patchCurrent)) {
                update(`There's an update available for Prisma Util! (current: v${current}, latest: v${latest})`, "\n");
            }
        } catch (err) {
            error("An error has occured while trying to check the CLI version.\n", "\n");
        }

        const { config, H, previewFeature } = actionCommand.optsWithGlobals();
        configPath = config;

        if(actionCommand.parent && actionCommand.parent.args.length > 0)
        {
            const ignoreConfig: string[] = [];

            if(!ignoreConfig.includes(actionCommand.parent.args[0]))
            {
                const {configData, created} = await createConfig(config);
                createdConfiguration = created;
                // Don't load anything yet until we're sure that we need it
                parser = new PrismaParser(configData, config);
                await parser.loadEnvironment();
            }
        }
    })
    .hook("postAction", async (command, actionCommand) => {
        if(parser && parser.loaded)
        {
            await parser.toolchain();
        }
    })

// Create configuration file
program
    .command("prepare")
    .action(async (options) => {
        if(createdConfiguration)
        {
            new MessageBuilder()
                .withHeader()
                .withTitle(chalk.gray(`Welcome to ${chalk.blue("Prisma Util")}!\n  The configuration file has been generated in ${chalk.blue("./prisma-util/config.mjs")}.`))
                .withNewLine()
                .withSection("If you are new to Prisma Util, we recommend the following guides: ", [`${chalk.white("Getting Started")} ${chalk.gray("https://prisma-util.gitbook.io/main/guides/getting-started")}`])
                .show();

            return;
        }
    });
// Match Prisma's version command
program
    .command("version")
    .alias("v")
    .description("The version command outputs information about your current prisma version, platform, and engine binaries.")
    .option("--json", "Outputs version information in JSON format.")
    .action(async (options) => {
        // Help menu
        if (options.H) {
            new MessageBuilder()
                .withHeader()
                .withTitle(chalk.gray("Print current version of Prisma components"))
                .withNewLine()
                .withSection("Usage", [`${chalk.gray("$")} prisma-util -v [options]`, `${chalk.gray("$")} prisma-util version [options]`])
                .withSection("Options", [`${chalk.gray("-h, --help")}     Display this help message`, `${chalk.gray("--json")}         Output JSON`])
                .show();
            return;
        }
        await runPrismaCommand(`version${options.json ? " --json" : ""}${options.previewFeature ? " --preview-feature" : ""}`);
    });

// Default command for when no subcommands have been added
program
    .command("help", { isDefault: true })
    .description("Help menu for Prisma Util.")
    .action(async () => {
        showIntro()
    });

function verifyDatasourceProvider(provider: string, dummyPrevious: string) {
    const allowed = ['sqlite', 'postgresql', 'mysql', 'sqlserver', 'mongodb', 'cockroachdb'];
    if (!allowed.includes(provider)) {
        error(`Provider ${chalk.bold(`${provider}`)} is invalid or not supported. Try again with "postgresql", "mysql", "sqlite", "sqlserver", "mongodb" or "cockroachdb".`);
        throw new commander.InvalidArgumentError(`Provider ${chalk.bold(`${provider}`)} is invalid or not supported. Try again with "postgresql", "mysql", "sqlite", "sqlserver", "mongodb" or "cockroachdb".`)
    }
    return provider;
}

// Match Prisma's init command
program
    .command("init")
    .description("The init command does not interpret any existing files. Instead, it creates a prisma directory containing a bare-bones schema.prisma file within your current directory.")
    .option("--datasource-provider [provider]", "Specifies the default value for the provider field in the datasource block.", verifyDatasourceProvider, "postgresql")
    .option("--url [url]", "Define a custom datasource url.", "null")
    .action(async (options) => {
        // Help menu
        if (options.H) {
            new MessageBuilder()
                .withHeader()
                .withTitle(chalk.gray("Set up a new Prisma project"))
                .withNewLine()
                .withSection("Usage", [`${chalk.gray("$")} prisma-util init [options]`])
                .withSection("Options", [`${chalk.gray("-h, --help")}  Display this help message`, `${chalk.gray("--datasource-provider")}      Define the datasource provider to use: PostgreSQL, MySQL, SQLite, SQL Server or MongoDB`, `${chalk.gray("--url")}      Define a custom datasource url`])
                .withSection("Examples",
                    [chalk.gray("Set up a new Prisma project with PostgreSQL (default)"), `${chalk.gray("$")} prisma-util init`, "",
                    chalk.gray("Set up a new Prisma project and specify MySQL as the datasource provider to use"), `${chalk.gray("$")} prisma-util init --datasource-provider mysql`, "",
                    chalk.gray("Set up a new Prisma project and specify the url that will be used"), `${chalk.gray("$")} prisma-util init --url mysql://user:password@localhost:3306/mydb`
                    ])
                .show();
            return;
        }

        if (typeof options.datasourceProvider == "boolean") {
            error(`Provider ${chalk.bold(`${options.datasourceProvider}`)} is invalid or not supported. Try again with "postgresql", "mysql", "sqlite", "sqlserver", "mongodb" or "cockroachdb".`);
            return;
        }

        if (typeof options.url == "boolean" || options.url == "null") {
            delete options["url"];
        }

        await runPrismaCommand(`init${options.url ? ` --url ${options.url}` : ""}${options.datasourceProvider ? ` --datasource-provider ${options.datasourceProvider}` : ""}${options.previewFeature ? " --preview-feature" : ""}`);
    });

// Match Prisma's generate command
program
    .command("generate")
    .description("The generate command generates assets like Prisma Client based on the generator and data model blocks defined in your prisma/schema.prisma file.")
    .option("--data-proxy [dataProxy]", "Define a custom datasource url.", "null")
    .action(async (options) => {
        // Help menu
        if (options.H) {
            new MessageBuilder()
                .withHeader()
                .withTitle(chalk.gray("Generate artifacts (e.g. Prisma Client)"))
                .withNewLine()
                .withSection("Usage", [`${chalk.gray("$")} prisma-util generate [options]`])
                .withSection("Options", [`${chalk.gray("-h, --help")}    Display this help message`, `${chalk.gray("--data-proxy")}  Enable the Data Proxy in the Prisma Client`])
                .show();
            return;
        }

        if (typeof options.dataProxy == "boolean" || options.dataProxy == "null") {
            delete options["dataProxy"];
        }

        parser = await parser.load();

        await fixConflicts();

        console.log();
        const spinner = ora({
            text: `${chalk.gray("Generating merged schema...")}`,
            prefixText: prismaCLITag
        }).start();
        await parser.writeSchema();
        spinner.stopAndPersist({
            text: `${chalk.gray("Merged schema generated successfully.")}`,
            prefixText: '',
            symbol: successTag
        });

        await runPrismaCommand(`generate --schema ./node_modules/.bin/generated-schema.prisma${options.dataProxy ? ` --data-proxy ${options.dataProxy}` : ""}${options.previewFeature ? " --preview-feature" : ""}`);
        await parser.generate();
    });

function commaSeparatedList(value: string) {
    return value.split(',');
}
// Match Prisma's format command
program
    .command("format")
    .description("Format a Prisma schema.")
    .option("--schema [schemas]", "The schemas to format", "")
    .action(async (options) => {
        // Help menu
        if (options.H) {
            new MessageBuilder()
                .withHeader()
                .withTitle(chalk.gray("Format a Prisma schema."))
                .withNewLine()
                .withSection("Usage", [`${chalk.gray("$")} prisma-util format [options]`])
                .withSection("Options", [`${chalk.gray("-h, --help")}    Display this help message`])
                .show();
            return;
        }

        if(options.schema && options.schema.trim() != "")
        {
            const schemas = commaSeparatedList(options.schema.trim());
            for(const schema of schemas)
            {
                await runPrismaCommand(`format --schema ${schema}${options.previewFeature ? " --preview-feature" : ""}`);
            }
        } else
        {
            parser = await parser.load();

            await fixConflicts();
    
            console.log();
            const spinner = ora({
                text: `${chalk.gray("Generating merged schema...")}`,
                prefixText: prismaCLITag
            }).start();
            await parser.writeSchema();
            spinner.stopAndPersist({
                text: `${chalk.gray("Merged schema generated successfully.")}`,
                prefixText: '',
                symbol: successTag
            });
            await runPrismaCommand(`format --schema ./node_modules/.bin/generated-schema.prisma${options.previewFeature ? " --preview-feature" : ""}`);
        }
    });

// Match Prisma's validate command
program
    .command("validate")
    .description("Validate a Prisma schema.")
    .action(async (options) => {
        // Help menu
        if (options.H) {
            new MessageBuilder()
                .withHeader()
                .withTitle(chalk.gray("Validate a Prisma schema."))
                .withNewLine()
                .withSection("Usage", [`${chalk.gray("$")} prisma-util validate [options]`])
                .withSection("Options", [`${chalk.gray("-h, --help")}    Display this help message`])
                .show();
            return;
        }

        await runPrismaCommand(`validate --schema ./${parser.config.baseSchema}${options.previewFeature ? " --preview-feature" : ""}`);
    });

// Match Prisma's db command
const db = program
    .command("db")
    .description("Manage your database schema and lifecycle during development.")
    .action((options) => {
        new MessageBuilder()
            .withHeader()
            .withTitle(chalk.gray("Manage your database schema and lifecycle during development."))
            .withNewLine()
            .withSection("Usage", [`${chalk.gray("$")} prisma-util db [command] [options]`])
            .withSection("Options", [`${chalk.gray("-h, --help")}    Display this help message`])
            .withSection("Commands",
                [` ${chalk.gray("pull")}    Pull the state from the database to the Prisma schema using introspection`,
                ` ${chalk.gray("push")}    Push the state from Prisma schema to the database during prototyping`,
                ` ${chalk.gray("seed")}    Seed your database`,
                ])
            .show();
    });

function compositeTypeDepthParser(value: string, dummyPrevious: string) {
    const parsedValue = parseInt(value, 10);
    if (isNaN(parsedValue)) {
        error(`Argument ${chalk.bold(`${value}`)} is not a number.`);
        throw new commander.InvalidArgumentError(`Argument ${chalk.bold(`${value}`)} is not a number.`);
    }
    return value;
}
createSubCommand(db, "pull")
    .option("--force", "Ignore current Prisma schema file")
    .option("--print", "Print the introspected Prisma schema to stdout")
    .option("--composite-type-depth [compositeTypeDepth]", "Specify the depth for introspecting composite types", compositeTypeDepthParser, "-1")
    .action(async (options, command) => {
        options = command.optsWithGlobals();
        options.compositeTypeDepth = parseInt(options.compositeTypeDepth, 10);

        if (options.H) {
            new MessageBuilder()
                .withHeader()
                .withTitle(chalk.gray("Pull the state from the database to the Prisma schema using introspection"))
                .withNewLine()
                .withSection("Usage", [`${chalk.gray("$")} prisma-util db pull [flags/options]`])
                .withSection("Flags", [`${chalk.gray("-h, --help")}    Display this help message`, `   ${chalk.gray("--force")}    Ignore current Prisma schema file`, `   ${chalk.gray("--print")}    Print the introspected Prisma schema to stdout`])
                .withSection("Options",
                    [`${chalk.gray("--composite-type-depth")}    Specify the depth for introspecting composite types\n                          (e.g. Embedded Documents in MongoDB)\n                          Number, default is -1 for infinite depth, 0 = off`,
                    ])
                .withSection("Examples",
                    [chalk.gray("Instead of saving the result to the filesystem, you can also print it to stdout"), `${chalk.gray("$")} prisma-util db pull --print`, "",
                    chalk.gray("Overwrite the current schema with the introspected schema instead of enriching it"), `${chalk.gray("$")} prisma-util db pull --force`, "",
                    chalk.gray("Set composite types introspection depth to 2 levels"), `${chalk.gray("$")} prisma-util db pull --composite-type-depth=2`
                    ])
                .show();
            return;
        }

        await runPrismaCommand(`db pull${options.force ? " --force" : ""}${options.print ? " --print" : ""} --composite-type-depth ${options.compositeTypeDepth} --schema ./${parser.config.baseSchema}${options.previewFeature ? " --preview-feature" : ""}`);
    });
createSubCommand(db, "push")
    .option("--accept-data-loss", "Ignore data loss warnings")
    .option("--force-reset", "Force a reset of the database before push")
    .option("--skip-generate", "Skip triggering generators (e.g. Prisma Client)")
    .action(async (options, command) => {
        options = command.optsWithGlobals();

        if (options.H) {
            new MessageBuilder()
                .withHeader()
                .withTitle(chalk.gray("Push the state from your Prisma schema to your database"))
                .withNewLine()
                .withSection("Usage", [`${chalk.gray("$")} prisma-util db push [options]`])
                .withSection("Options",
                    [`           ${chalk.gray("-h, --help")}    Display this help message`,
                    `   ${chalk.gray("--accept-data-loss")}    Ignore data loss warnings`,
                    `        ${chalk.gray("--force-reset")}    Force a reset of the database before push`,
                    `      ${chalk.gray("--skip-generate")}    Skip triggering generators (e.g. Prisma Client)`,
                    ])
                .withSection("Examples",
                    [chalk.gray("Ignore data loss warnings"), `${chalk.gray("$")} prisma-util db push --accept-data-loss`
                    ])
                .show();
            return;
        }

        parser = await parser.load();

        await fixConflicts();

        console.log();
        const spinner = ora({
            text: `${chalk.gray("Generating merged schema...")}`,
            prefixText: prismaCLITag
        }).start();
        await parser.writeSchema();
        spinner.stopAndPersist({
            text: `${chalk.gray("Merged schema generated successfully.")}`,
            prefixText: '',
            symbol: successTag
        });

        await runPrismaCommand(`db push${options.acceptDataLoss ? " --accept-data-loss" : ""}${options.forceReset ? " --force-reset" : ""}${options.skipGenerate ? " --skip-generate" : ""} --schema ./node_modules/.bin/generated-schema.prisma${options.previewFeature ? " --preview-feature" : ""}`);
        if(!options.skipGenerate)
            await parser.generate();
    });
createSubCommand(db, "seed")
    .description("Seed your database")
    .action(async (options, command) => {
        options = command.optsWithGlobals();

        if (options.H) {
            new MessageBuilder()
                .withHeader()
                .withTitle(chalk.gray("Seed your database"))
                .withNewLine()
                .withSection("Usage", [`${chalk.gray("$")} prisma-util db seed [options]`])
                .withSection("Options",
                    [`${chalk.gray("-h, --help")}    Display this help message`,])
                .show();
            return;
        }

        await runPrismaCommand(`db seed${options.previewFeature ? " --preview-feature" : ""}`);
    });

// Schema command for additional use-cases
program
    .command("schema")
    .description("Generate schemas using Prisma Util without running additional commands")
    .option("--path [path]", "Path to save the file to.", "./node_modules/.bin/generated-schema.prisma")
    .action(async (options) => {
        if (options.H) {
            new MessageBuilder()
                .withHeader()
                .withTitle(chalk.gray("Generate schemas using Prisma Util without running additional commands"))
                .withNewLine()
                .withSection("Usage", [`${chalk.gray("$")} prisma-util schema [options]`])
                .withSection("Options",
                    [
                        `${chalk.gray("-h, --help")}    Display this help message`, 
                        `    ${chalk.gray("--path")}    Path to save the file to.`
                    ])
                .show();
            return;
        }

        parser = await parser.load();

        await fixConflicts();

        console.log();
        const spinner = ora({
            text: `${chalk.gray("Generating merged schema...")}`,
            prefixText: prismaCLITag
        }).start();
        await parser.writeSchema(options.path);
        spinner.stopAndPersist({
            text: `${chalk.gray("Merged schema generated successfully.")}`,
            prefixText: '',
            symbol: successTag
        });
    });

// Match Prisma's migrate command
const migrate = program
    .command("migrate")
    .description("Update the database schema with migrations")
    .action((options) => {
        new MessageBuilder()
            .withHeader()
            .withTitle(chalk.gray("Update the database schema with migrations"))
            .withNewLine()
            .withSection("Usage", [`${chalk.gray("$")} prisma-util migrate [command] [options]`])
            .withSection("Commands for development",
                [`  ${chalk.gray("dev")}    Create a migration from changes in Prisma schema, apply it to the database\n           trigger generators (e.g. Prisma Client)`,
                `${chalk.gray("reset")}    Reset your database and apply all migrations, all data will be lost`
                ])
            .withSection("Commands for production/staging",
                [` ${chalk.gray("deploy")}    Apply pending migrations to the database`,
                ` ${chalk.gray("status")}    Check the status of your database migrations`,
                `${chalk.gray("resolve")}    Resolve issues with database migrations, i.e. baseline, failed migration, hotfix`
                ])
            .withSection("Commands for any stage",
                [`${chalk.gray("diff")}    Compare the database schema from two arbitrary sources`
                ])
            .withSection("Options", [`${chalk.gray("-h, --help")}    Display this help message`])
            .withSection("Examples",
                [chalk.gray("Create a migration from changes in Prisma schema, apply it to the database, trigger generators (e.g. Prisma Client)"), `${chalk.gray("$")} prisma-util migrate dev`, "",
                chalk.gray("Reset your database and apply all migrations"), `${chalk.gray("$")} prisma-util migrate reset`, "",
                chalk.gray("Apply pending migrations to the database in production/staging"), `${chalk.gray("$")} prisma-util migrate deploy`, "",
                chalk.gray("Check the status of migrations in the production/staging database"), `${chalk.gray("$")} prisma-util migrate status`, "",
                chalk.gray("Reset your database and apply all migrations"), `${chalk.gray("$")} prisma-util migrate reset`, "",
                chalk.gray("Compare the database schema from two databases and render the diff as a SQL script"), `${chalk.gray("$")} prisma-util migrate diff \\`, "  --from-url \"$DATABASE_URL\" \\", "  --to-url \"postgresql://login:password@localhost:5432/db\" \\", "  --script",
                ])
            .show();
    });
createSubCommand(migrate, "dev")
    .option("-n, --name [name]", "Name the migration")
    .option("--create-only", "Create a new migration but do not apply it")
    .option("--skip-generate", "Skip triggering generators (e.g. Prisma Client)")
    .option("--skip-seed", "Skip triggering seed")
    .option("--force", "Bypass environment lock")
    .action(async (options, command) => {
        options = command.optsWithGlobals();

        if (options.H) {
            new MessageBuilder()
                .withHeader()
                .withTitle(chalk.gray("Create a migration from changes in Prisma schema, apply it to the database, trigger generators (e.g. Prisma Client)"))
                .withNewLine()
                .withSection("Usage", [`${chalk.gray("$")} prisma-util migrate dev [options]`])
                .withSection("Options",
                    [`     ${chalk.gray("-h, --help")}    Display this help message`,
                    `     ${chalk.gray("-n, --name")}    Name the migration`,
                    `  ${chalk.gray("--create-only")}    Create a new migration but do not apply it\n                     The migration will be empty if there are no changes in Prisma schema`,
                    `${chalk.gray("--skip-generate")}    Skip triggering generators (e.g. Prisma Client)`,
                    `    ${chalk.gray("--skip-seed")}    Skip triggering seed`
                    ])
                .withSection("Examples",
                    [chalk.gray("Create a migration from changes in Prisma schema, apply it to the database, trigger generators (e.g. Prisma Client)"), `${chalk.gray("$")} prisma-util migrate dev`, "",
                    chalk.gray("Create a migration without applying it"), `${chalk.gray("$")} prisma-util migrate dev --create-only`
                    ])
                .show();
            return;
        }

        parser = await parser.load();

        if(parser.config.environmentLock && process.env.NODE_ENV == "production" && !options.force)
        {
            warn(`${chalk.bold("Environment Lock")}\nBecause you've enabled the ${chalk.bold("environmentLock")} optional feature in the configuration file, you can't run ${chalk.bold("migrate dev")} while ${chalk.bold("process.env.NODE_ENV")} is set to ${chalk.bold("production")}.\nTo bypass this lock, use the ${chalk.bold("--force")} flag or disable ${chalk.bold("environmentLock")}.`, "\n")
            process.exit(0);
            return;
        }

        await fixConflicts();

        console.log();
        const spinner = ora({
            text: `${chalk.gray("Generating merged schema...")}`,
            prefixText: prismaCLITag
        }).start();
        await parser.writeSchema();
        spinner.stopAndPersist({
            text: `${chalk.gray("Merged schema generated successfully.")}`,
            prefixText: '',
            symbol: successTag
        });

        const modifiedMigration = await parser.migrate(`migrate dev${options.name ? ` -n ${options.name}` : ""}${options.skipSeed ? " --skip-seed" : ""}${options.skipGenerate ? " --skip-generate" : ""} --schema ./node_modules/.bin/generated-schema.prisma${options.previewFeature ? " --preview-feature" : ""}`);
        if(modifiedMigration && options.createOnly)
            return;
        await runPrismaCommand(`migrate dev${options.name ? ` -n ${options.name}` : ""}${options.createOnly ? " --create-only" : ""}${options.skipSeed ? " --skip-seed" : ""}${options.skipGenerate ? " --skip-generate" : ""} --schema ./node_modules/.bin/generated-schema.prisma${options.previewFeature ? " --preview-feature" : ""}`);

        if(await parser.fixMigrate())
        {
            experimental("Retrying to run the command.", "\n");
            await runPrismaCommand(`migrate deploy --schema ./node_modules/.bin/generated-schema.prisma${options.previewFeature ? " --preview-feature" : ""}`);
            await runPrismaCommand(`generate --schema ./node_modules/.bin/generated-schema.prisma${options.previewFeature ? " --preview-feature" : ""}`);
        }
        if(!options.skipGenerate)
            await parser.generate();
    });

createSubCommand(migrate, "reset")
    .option("-f, --force", "Skip the confirmation prompt")
    .option("--skip-generate", "Skip triggering generators (e.g. Prisma Client)")
    .option("--skip-seed", "Skip triggering seed")
    .option("--reset-only", "Do not apply any migrations")
    .action(async (options, command) => {
        options = command.optsWithGlobals();

        if (options.H) {
            new MessageBuilder()
                .withHeader()
                .withTitle(chalk.gray("Reset your database and apply all migrations, all data will be lost"))
                .withNewLine()
                .withSection("Usage", [`${chalk.gray("$")} prisma-util migrate reset [options]`])
                .withSection("Options",
                    [`     ${chalk.gray("-h, --help")}    Display this help message`,
                    `${chalk.gray("--skip-generate")}    Skip triggering generators (e.g. Prisma Client)`,
                    `    ${chalk.gray("--skip-seed")}    Skip triggering seed`,
                    `    ${chalk.gray("-f, --force")}    Skip the confirmation prompt`
                    ])
                .withSection("Examples",
                    [chalk.gray("Reset your database and apply all migrations, all data will be lost"), `${chalk.gray("$")} prisma-util migrate reset`, "",
                    chalk.gray("Use --force to skip the confirmation prompt"), `${chalk.gray("$")} prisma-util migrate reset --force`
                    ])
                .show();
            return;
        }

        parser = await parser.load();

        await fixConflicts();

        console.log();
        const spinner = ora({
            text: `${chalk.gray("Generating merged schema...")}`,
            prefixText: prismaCLITag
        }).start();
        await parser.writeSchema();
        spinner.stopAndPersist({
            text: `${chalk.gray("Merged schema generated successfully.")}`,
            prefixText: '',
            symbol: successTag
        });

        if(options.resetOnly)
        {
            await parser.resetMigrations();
        }
        await runPrismaCommand(`migrate reset${options.force ? ` --force` : ""}${options.skipSeed ? " --skip-seed" : ""}${options.skipGenerate ? " --skip-generate" : ""} --schema ./node_modules/.bin/generated-schema.prisma${options.previewFeature ? " --preview-feature" : ""}`);
        if(!options.skipGenerate)
            await parser.generate();
    });
createSubCommand(migrate, "deploy")
    .description("Apply pending migrations to update the database schema in production/staging")
    .action(async (options, command) => {
        options = command.optsWithGlobals();

        if(options.H)
        {
            new MessageBuilder()
                .withHeader()
                .withTitle(chalk.gray("Apply pending migrations to update the database schema in production/staging"))
                .withNewLine()
                .withSection("Usage", [`${chalk.gray("$")} prisma-util migrate deploy [options]`])
                .withSection("Options", [`${chalk.gray("-h, --help")}    Display this help message`])
                .show();
            return;
        }

        parser = await parser.load();

        await fixConflicts();

        console.log();
        const spinner = ora({
            text: `${chalk.gray("Generating merged schema...")}`,
            prefixText: prismaCLITag
        }).start();
        await parser.writeSchema();
        spinner.stopAndPersist({
            text: `${chalk.gray("Merged schema generated successfully.")}`,
            prefixText: '',
            symbol: successTag
        });

        await runPrismaCommand(`migrate deploy --schema ./node_modules/.bin/generated-schema.prisma${options.previewFeature ? " --preview-feature" : ""}`);
    });
createSubCommand(migrate, "resolve")
    .option("--applied [applied]", "Record a specific migration as applied")
    .option("--rolled-back [rolledBack]", "Record a specific migration as rolled back")
    .action(async (options, command) => {
        options = command.optsWithGlobals();

        if(options.H)
        {
            new MessageBuilder()
                .withHeader()
                .withTitle(chalk.gray("Resolve issues with database migrations in deployment databases:"))
                .withTitle(chalk.gray("- recover from failed migrations"))
                .withTitle(chalk.gray("- baseline databases when starting to use Prisma Migrate on existing databases"))
                .withTitle(chalk.gray("- reconcile hotfixes done manually on databases with your migration history"))
                .withNewLine()
                .withTitle(chalk.gray(`Run ${chalk.blue("prisma-cli migrate status")} to identify if you need to use resolve.`))
                .withNewLine()
                .withTitle(chalk.gray("Read more about resolving migration history issues: https://pris.ly/d/migrate-resolve"))
                .withNewLine()
                .withSection("Usage", [`${chalk.gray("$")} prisma-util migrate resolve [options]`])
                .withSection("Options", 
                [
                    `   ${chalk.gray("-h, --help")}    Display this help message`,
                    `    ${chalk.gray("--applied")}    Record a specific migration as applied`,
                    `${chalk.gray("--rolled-back")}    Record a specific migration as rolled back`
                ])
                .withSection("Examples",
                [
                    chalk.gray("Update migrations table, recording a specific migration as applied"), `${chalk.gray("$")} prisma-util migrate resolve --applied 20201231000000_add_users_table`, "",
                    chalk.gray("Update migrations table, recording a specific migration as rolled back"), `${chalk.gray("$")} prisma-util migrate resolve --rolled-back 20201231000000_add_users_table`
                ])
                .show();
            return;
        }

        parser = await parser.load();

        await fixConflicts();

        console.log();
        const spinner = ora({
            text: `${chalk.gray("Generating merged schema...")}`,
            prefixText: prismaCLITag
        }).start();
        await parser.writeSchema();
        spinner.stopAndPersist({
            text: `${chalk.gray("Merged schema generated successfully.")}`,
            prefixText: '',
            symbol: successTag
        });

        await runPrismaCommand(`migrate resolve${options.applied ? ` --applied ${options.applied}` : ""}${options.rolledBack ? ` --rolled-back ${options.rolledBack}` : ""} --schema ./node_modules/.bin/generated-schema.prisma${options.previewFeature ? " --preview-feature" : ""}`);
    });
createSubCommand(migrate, "status")
    .description("Check the status of your database migrations")
    .action(async (options, command) => {
        options = command.optsWithGlobals();

        if(options.H)
        {
            new MessageBuilder()
                .withHeader()
                .withTitle(chalk.gray("Check the status of your database migrations"))
                .withNewLine()
                .withSection("Usage", [`${chalk.gray("$")} prisma-util migrate status [options]`])
                .withSection("Options", [`${chalk.gray("-h, --help")}    Display this help message`])
                .show();
            return;
        }

        parser = await parser.load();

        await fixConflicts();

        console.log();
        const spinner = ora({
            text: `${chalk.gray("Generating merged schema...")}`,
            prefixText: prismaCLITag
        }).start();
        await parser.writeSchema();
        spinner.stopAndPersist({
            text: `${chalk.gray("Merged schema generated successfully.")}`,
            prefixText: '',
            symbol: successTag
        });

        await runPrismaCommand(`migrate status --schema ./node_modules/.bin/generated-schema.prisma${options.previewFeature ? " --preview-feature" : ""}`);
    });
createSubCommand(migrate, "diff")
    .description("Compares the database schema from two arbitrary sources, and outputs the differences either as a human-readable summary (by default) or an executable script.")
    .option("--from-url [fromUrl]")
    .option("--to-url [toUrl]")

    .option("--from-empty")
    .option("--to-empty")

    .option("--from-schema-datamodel [fromDataModel]")
    .option("--to-schema-datamodel [toDataModel]")

    .option("--from-schema-datasource [fromDataSource]")
    .option("--to-schema-datasource [toDataSource]")

    .option("--from-migrations [fromMigrations]")
    .option("--to-migrations [toMigrations]")

    .option("--shadow-database-url [shadowDatabase]")

    .option("--script")
    .option("--exit-code")
    .action(async (options, command) => {
        options = command.optsWithGlobals();

        if(options.H)
        {
            new MessageBuilder()
                .withHeader()
                .withTitle(chalk.gray("Compares the database schema from two arbitrary sources, and outputs the differences either as a human-readable summary (by default) or an executable script."))
                .withNewLine()
                .withTitle(chalk.gray(`${chalk.blue("prisma-util migrate diff")} is a read-only command that does not write to your datasource(s).`))
                .withTitle(chalk.gray(`${chalk.blue("prisma-util db execute")} can be used to execute its ${chalk.blue("--script")} output.`))
                .withNewLine()
                .withTitle(chalk.gray(`The command takes a source ${chalk.blue("--from-...")} and a destination ${chalk.blue("--to-...")}.`))
                .withTitle(chalk.gray(`The source and destination must use the same provider,`))
                .withTitle(chalk.gray(`e.g. a diff using 2 different providers like PostgreSQL and SQLite is not supported.`))
                .withNewLine()
                .withTitle(chalk.gray("It compares the source with the destination to generate a diff."))
                .withTitle(chalk.gray("The diff can be interpreted as generating a migration that brings the source schema (from) to the shape of the destination schema (to)."))
                .withTitle(chalk.gray(`The default output is a human readable diff, it can be rendered as SQL using ${chalk.blue("--script")} on SQL databases.`))
                .withNewLine()
                .withTitle(chalk.gray("See the documentation for more information https://pris.ly/d/migrate-diff"))
                .withNewLine()
                .withSection("Usage", [`${chalk.gray("$")} prisma-util migrate diff [options]`])
                .withSection("Options", 
                [
                    `${chalk.gray("-h, --help")}    Display this help message`, "",
                    chalk.italic("From and To inputs (1 `--from-...` and 1 `--to-...` must be provided):"), 
                    `${chalk.gray("--from-url")}               A datasource URL`,
                    chalk.gray("--to-url"), "",
                    `${chalk.gray("--from-empty")}             Flag to assume from or to is an empty datamodel`,
                    chalk.gray("--to-empty"), "",
                    `${chalk.gray("--from-schema-datamodel")}  Path to a Prisma schema file, uses the ${chalk.italic("datamodel")} for the diff`,
                    `${chalk.gray("--to-schema-datamodel")}    You can also use ${chalk.blue("base")} for your base schema and ${chalk.blue("generated")} for the generated one`, "",
                    `${chalk.gray("--from-schema-datasource")} Path to a Prisma schema file, uses the ${chalk.italic("datasource url")} for the diff`,
                    `${chalk.gray("--to-schema-datasource")}   You can also use ${chalk.blue("base")} for your base schema and ${chalk.blue("generated")} for the generated one`, "",
                    `${chalk.gray("--from-migrations")}        Path to the Prisma Migrate migrations directory`,
                    chalk.gray("--to-migrations"), "",
                    chalk.italic("Shadow database (only required if using --from-migrations or --to-migrations):"),
                    `${chalk.gray("--shadow-database-url")}    URL for the shadow database`,
                ])
                .withSection("Flags", 
                [
                    `${chalk.gray("--script")}                 Render a SQL script to stdout instead of the default human readable summary (not supported on MongoDB)`, 
                    `${chalk.gray("--exit-code")}              Change the exit code behavior to signal if the diff is empty or not (Empty: 0, Error: 1, Not empty: 2). Default behavior is Success: 0, Error: 1.`, 
                ])
                .withSection("Examples",
                [
                    chalk.gray("From database to database as summary"), chalk.gray("  e.g. compare two live databases"), `${chalk.gray("$")} prisma-util migrate diff \\`, "  --from-url \"postgresql://login:password@localhost:5432/db1\" \\", "  --to-url \"postgresql://login:password@localhost:5432/db2\" \\", "",
                    chalk.gray("From a live database to a Prisma datamodel"), chalk.gray("  e.g. roll forward after a migration failed in the middle"), `${chalk.gray("$")} prisma-util migrate diff \\`, "  --shadow-database-url \"postgresql://login:password@localhost:5432/db1\" \\", "  --from-url \"postgresql://login:password@localhost:5432/db2\" \\", "  --to-schema-datamodel=next_datamodel.prisma \\", "  --script", "",
                    chalk.gray("From a live database to a datamodel"), chalk.gray("  e.g. roll backward after a migration failed in the middle"), `${chalk.gray("$")} prisma-util migrate diff \\`, "  --shadow-database-url \"postgresql://login:password@localhost:5432/db1\" \\", "  --from-url \"postgresql://login:password@localhost:5432/db2\" \\", "  --to-schema-datamodel=previous_datamodel.prisma \\", "  --script", "",
                    chalk.gray(`From a Prisma Migrate ${chalk.blue("migrations")} directory to another database`), chalk.gray("  e.g. generate a migration for a hotfix already applied on production"), `${chalk.gray("$")} prisma-util migrate diff \\`, "  --shadow-database-url \"postgresql://login:password@localhost:5432/db1\" \\", "  --from-migrations ./migrations \\", "  --to-url \"postgresql://login:password@localhost:5432/db2\" \\", "  --script", "",
                    chalk.gray("Detect if both sources are in sync, it will exit with exit code 2 if changes are detected"), `${chalk.gray("$")} prisma-util migrate diff \\`, "  --exit-code \\", "  --from-[...] \\", "  --to-[...]"
                ])
                .show();
            return;
        }

        const shouldGenerate = [options.fromSchemaDatamodel, options.toSchemaDatamodel, options.fromSchemaDatasource, options.toSchemaDatasource].includes("generated");

        if(shouldGenerate)
        {
            parser = await parser.load();

            await fixConflicts();
    
            console.log();
            const spinner = ora({
                text: `${chalk.gray("Generating merged schema...")}`,
                prefixText: prismaCLITag
            }).start();
            await parser.writeSchema();
            spinner.stopAndPersist({
                text: `${chalk.gray("Merged schema generated successfully.")}`,
                prefixText: '',
                symbol: successTag
            });

            options.fromSchemaDatamodel = options.fromSchemaDatamodel == "generated" ? "./node_modules/.bin/generated-schema.prisma" : options.fromSchemaDatamodel;
            options.toSchemaDatamodel = options.toSchemaDatamodel == "generated" ? "./node_modules/.bin/generated-schema.prisma" : options.toSchemaDatamodel;
            options.fromSchemaDatasource = options.fromSchemaDatasource == "generated" ? "./node_modules/.bin/generated-schema.prisma" : options.fromSchemaDatasource;
            options.toSchemaDatasource = options.toSchemaDatasource == "generated" ? "./node_modules/.bin/generated-schema.prisma" : options.toSchemaDatasource;
        }

        options.fromSchemaDatamodel = options.fromSchemaDatamodel == "base" ? parser.config.baseSchema : options.fromSchemaDatamodel;
        options.toSchemaDatamodel = options.toSchemaDatamodel == "base" ? parser.config.baseSchema : options.toSchemaDatamodel;
        options.fromSchemaDatasource = options.fromSchemaDatasource == "base" ? parser.config.baseSchema : options.fromSchemaDatasource;
        options.toSchemaDatasource = options.toSchemaDatasource == "base" ? parser.config.baseSchema : options.toSchemaDatasource;

        await runPrismaCommand(`migrate diff${options.fromSchemaDatamodel ? ` --from-schema-datamodel ${options.fromSchemaDatamodel}` : ""}${options.toSchemaDatamodel ? ` --to-schema-datamodel ${options.toSchemaDatamodel}` : ""}${options.fromSchemaDatasource ? ` --from-schema-datasource ${options.fromSchemaDatasource}` : ""}${options.toSchemaDatasource ? ` --to-schema-datasource ${options.toSchemaDatasource}` : ""}${options.fromMigrations ? ` --from-migrations ${options.fromMigrations}` : ""}${options.toMigrations ? ` --to-migrations ${options.toMigrations}` : ""}${options.shadowDatabaseUrl ? ` --shadow-database-url ${options.shadowDatabaseUrl}` : ""}${options.script ? " --script" : ""}${options.exitCode ? " --exit-code" : ""}${options.fromEmpty ? " --from-empty" : ""}${options.toEmpty ? " --to-empty" : ""}${options.fromUrl ? ` --from-url ${options.fromUrl}` : ""}${options.toUrl ? ` --to-url ${options.toUrl}` : ""}${options.previewFeature ? " --preview-feature" : ""}`);
    });

// Match Prisma's studio command
program
    .command('studio')
    .description('Browse your data with Prisma Studio')
    .option('-p, --port [port]', "Port to start Studio on", compositeTypeDepthParser, "5555")
    .option('-b, --browser [browser]', "Browser to open Studio in")
    .option('-n, --hostname', "Hostname to bind the Express server to")
    .action(async (options) => {
        options.port = parseInt(options.port, 10);

        if (options.H) {
            new MessageBuilder()
                .withHeader()
                .withTitle(chalk.gray("Browse your data with Prisma Studio"))
                .withNewLine()
                .withSection("Usage", [`${chalk.gray("$")} prisma-util studio [options]`])
                .withSection("Options",
                    [`    ${chalk.gray("-h, --help")}    Display this help message`,
                     `    ${chalk.gray("-p, --port")}    Port to start Studio on`,
                     ` ${chalk.gray("-b, --browser")}    Browser to open Studio in`,
                     `${chalk.gray("-n, --hostname")}    Hostname to bind the Express server to`
                    ])
                .withSection("Examples",
                    [chalk.gray("Start Studio on the default port"), `${chalk.gray("$")} prisma-util studio`, "",
                    chalk.gray("Start Studio on a custom port"), `${chalk.gray("$")} prisma-util studio --port 5555`, "",
                    chalk.gray("Start Studio in a specific browser"), `${chalk.gray("$")} prisma-util studio --port 5555 --browser firefox`, "",
                    chalk.gray("Start Studio without opening in a browser"), `${chalk.gray("$")} prisma-util studio --port 5555 --browser none`
                    ])
                .show();
            return;
        }

        parser = await parser.load();

        await fixConflicts();

        console.log();
        const spinner = ora({
            text: `${chalk.gray("Generating merged schema...")}`,
            prefixText: prismaCLITag
        }).start();
        await parser.writeSchema();
        spinner.stopAndPersist({
            text: `${chalk.gray("Merged schema generated successfully.")}`,
            prefixText: '',
            symbol: successTag
        });

        await runPrismaCommand(`studio --port ${options.port}${options.browser ? ` --browser ${options.browser}` : ""}${options.hostname ? ` --hostname ${options.hostname}` : ""} --schema ./node_modules/.bin/generated-schema.prisma${options.previewFeature ? " --preview-feature" : ""}`);
    });

// Add Prisma Util and Prisma flags to all commands.
program.commands.forEach((cmd) => {
    cmd.option("--config [config]", "Specify a different path for the Prisma Util config", "config.mjs")
        .option("--help, -h", "Display this help message")
        .option("--preview-feature", "Run Preview Prisma commands")
});

// Run the commands
program.parse();

async function fixConflicts(iterationCount = 0) {
    return new Promise<void>(async (resolve) => {
        let conflicts = await parser.getConflicts();

        if (conflicts.length == 0) {
            success("All conflicts resolved, proceeding with command.", "\n");
            resolve();
        } else {
            if (iterationCount == 0)
                conflict("Conflicts detected, please answer the questions below.", "\n");
            const conflictNow = {
                1: conflicts[0][1].name,
                2: conflicts[0][2].name
            };
            const conflictNowTypes = {
                1: conflicts[0][1].type,
                2: conflicts[0][2].type,
            }

            // Both should be the same
            const referred1 = parser.getReferredRelations(conflictNow[1]);
            const referred2 = parser.getReferredRelations(conflictNow[2]);
            if ((referred1.length > 0 || referred2.length > 0) && !parser.config.crossFileRelations) {
                error(`Cross-file relations are not enabled in ${chalk.bold(parser.configPath)}.\n`, `\n`)
                process.exit(1);
            }

            // Try to fix with config file
            const canMap = {
                1: false,
                2: false
            }
            referred1.forEach((ref) => {
                const res = parser.canFixCrossFileWithMapper(`${ref.model}.${ref.column.name}`);
                if (res) {
                    parser.suggest(conflictNow[1], {
                        type: "remap",
                        from: `${ref.model}.${ref.column.name}`,
                        to: res,
                        item: conflictNowTypes[1]
                    });
                    canMap[1] = conflictNow[1] == res;
                    canMap[2] = conflictNow[2] == res;
                }
            });

            // If there is another one, ask the user for help
            const canMapAny = canMap[1] || canMap[2];
            if (canMapAny) {
                const mapper = canMap[1] ? {
                    name: conflictNow[1],
                    type: conflictNowTypes[1]
                } : {
                    name: conflictNow[2],
                    type: conflictNowTypes[2]
                };
                const other = canMap[1] ? {
                    name: conflictNow[2],
                    type: conflictNowTypes[2]
                } : {
                    name: conflictNow[1],
                    type: conflictNowTypes[1]
                };
                experimental(`The ${chalk.bold("Automatic Mapper")} can't process a conflict automatically.\n`, "\n");
                const answers = await inquirer.prompt({
                    name: `resolver_${iterationCount}`,
                    type: 'list',
                    prefix: conflictTag,
                    message: chalk.gray(`Review your schema, then choose an option to solve the conflict.\n\n${chalk.magenta(`${mapper.name}${mapper.type == "enum" ? " (Enum)" : ""}`)} is referenced in your configuration file as the replacement for another model.\nHowever, ${chalk.magenta(`${other.name}${other.type == "enum" ? " (Enum)" : ""}`)} has the same model name as the generated one would.\nPlease choose one of the options below.\n\n${chalk.gray("Your choice:")}`),
                    choices: [
                        `Skip ${chalk.magenta(`${other.name}${other.type == "enum" ? " (Enum)" : ""}`)}`,
                        `Rename ${chalk.magenta(`${other.name}${other.type == "enum" ? " (Enum)" : ""}`)}`,
                    ],
                });
                const answer = answers[`resolver_${iterationCount}`].replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, "");
                switch (answer) {
                    case `Skip ${other.name}${other.type == "enum" ? " (Enum)" : ""}`:
                        parser.suggest(other.name, { type: "skip", item: other.type })
                        break;
                    case `Rename ${other.name}${other.type == "enum" ? " (Enum)" : ""}`:
                        const name1 = (await inquirer.prompt({
                            name: `resolver_rename_${iterationCount}`,
                            type: 'input',
                            prefix: conflictTag,
                            message: chalk.gray(`What is the new name for ${chalk.magenta(`${other.name}${other.type == "enum" ? " (Enum)" : ""}`)}?`),
                        }))[`resolver_rename_${iterationCount}`];

                        parser.suggest(other.name, {
                            type: "rename",
                            newName: name1, item: other.type
                        });
                        break;
                }
                resolve(fixConflicts(iterationCount + 1));
                return;
            }

            // Show never be shown unless the json is parsed incorrectly
            const warningText = canMap[1] && canMap[2] ? `${chalk.yellow("Warning: ")}Both ${chalk.magenta(`${conflictNow[1]}${conflictNowTypes[1] == "enum" ? " (Enum)" : ""}`)} and ${chalk.magenta(`${conflictNow[2]}${conflictNowTypes[2] == "enum" ? " (Enum)" : ""}`)} are mapping the same column.\n\n` : ""
            console.log();
            const answers = await inquirer.prompt({
                name: `resolver_${iterationCount}`,
                type: 'list',
                prefix: conflictTag,
                message: chalk.gray(`Review your schema, then choose an option to solve the conflict.\n\nTwo models have the same name, please select an action.\n${chalk.magenta(`${conflictNow[1]}${conflictNowTypes[1] == "enum" ? " (Enum)" : ""}`)} and ${chalk.magenta(`${conflictNow[2]}${conflictNowTypes[2] == "enum" ? " (Enum)" : ""}`)}\n\n${warningText}${chalk.gray("Your choice:")}`),
                choices: [
                    `Skip ${chalk.magenta(`${conflictNow[1]}${conflictNowTypes[1] == "enum" ? " (Enum)" : ""}`)}`,
                    `Skip ${chalk.magenta(`${conflictNow[2]}${conflictNowTypes[2] == "enum" ? " (Enum)" : ""}`)}`,
                    `Rename ${chalk.magenta(`${conflictNow[1]}${conflictNowTypes[1] == "enum" ? " (Enum)" : ""}`)}`,
                    `Rename ${chalk.magenta(`${conflictNow[2]}${conflictNowTypes[2] == "enum" ? " (Enum)" : ""}`)}`,
                ],
            });

            // remove colors
            const answer = answers[`resolver_${iterationCount}`].replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, "");
            switch (answer) {
                case `Skip ${conflictNow[1]}${conflictNowTypes[1] == "enum" ? " (Enum)" : ""}`:
                    parser.suggest(conflictNow[1], { type: "skip", item: conflictNowTypes[1] })
                    break;
                case `Skip ${conflictNow[2]}${conflictNowTypes[2] == "enum" ? " (Enum)" : ""}`:
                    parser.suggest(conflictNow[2], { type: "skip", item: conflictNowTypes[2] })
                    break;
                case `Rename ${conflictNow[1]}${conflictNowTypes[1] == "enum" ? " (Enum)" : ""}`:
                    const name1 = (await inquirer.prompt({
                        name: `resolver_rename_${iterationCount}`,
                        type: 'input',
                        prefix: conflictTag,
                        message: chalk.gray(`What is the new name for ${chalk.magenta(`${conflictNow[1]}${conflictNowTypes[1] == "enum" ? " (Enum)" : ""}`)}?`),
                    }))[`resolver_rename_${iterationCount}`];

                    parser.suggest(conflictNow[1], {
                        type: "rename",
                        newName: name1, 
                        item: conflictNowTypes[1]
                    })
                    break;
                case `Rename ${conflictNow[2]}${conflictNowTypes[2] == "enum" ? " (Enum)" : ""}`:
                    const name2 = (await inquirer.prompt({
                        name: `resolver_rename_${iterationCount}`,
                        type: 'input',
                        prefix: conflictTag,
                        message: chalk.gray(`What is the new name for ${chalk.magenta(`${conflictNow[2]}${conflictNowTypes[2] == "enum" ? " (Enum)" : ""}`)}?`),
                    }))[`resolver_rename_${iterationCount}`];

                    parser.suggest(conflictNow[2], {
                        type: "rename",
                        newName: name2,
                        item: conflictNowTypes[2]
                    })
                    break;
            }

            resolve(fixConflicts(iterationCount + 1));
        }
    })
}

// Sub command helper
function createSubCommand(command: commander.Command, nameAndArgs: string) {
    const subCommand = command.command(nameAndArgs);
    return subCommand;
}
