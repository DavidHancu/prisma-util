import * as commander from "commander";
import MessageBuilder from '../messages.js';
import chalk from 'chalk';
import { error } from '../logger.js';
import { createSubCommand, runPrismaCommand } from '../utils.js';
export default function command(program, parser) {
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
            .withSection("Commands", [`   ${chalk.gray("pull")}    Pull the state from the database to the Prisma schema using introspection`,
            `   ${chalk.gray("push")}    Push the state from Prisma schema to the database during prototyping`,
            `   ${chalk.gray("seed")}    Seed your database`,
            `${chalk.gray("execute")}    Execute native commands to your database`
        ])
            .show();
    });
    function compositeTypeDepthParser(value, dummyPrevious) {
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
                .withSection("Options", [`${chalk.gray("--composite-type-depth")}    Specify the depth for introspecting composite types\n                          (e.g. Embedded Documents in MongoDB)\n                          Number, default is -1 for infinite depth, 0 = off`,
            ])
                .withSection("Examples", [chalk.gray("Instead of saving the result to the filesystem, you can also print it to stdout"), `${chalk.gray("$")} prisma-util db pull --print`, "",
                chalk.gray("Overwrite the current schema with the introspected schema instead of enriching it"), `${chalk.gray("$")} prisma-util db pull --force`, "",
                chalk.gray("Set composite types introspection depth to 2 levels"), `${chalk.gray("$")} prisma-util db pull --composite-type-depth=2`
            ])
                .show();
            return;
        }
        await runPrismaCommand(`db pull${options.force ? " --force" : ""}${options.print ? " --print" : ""} --composite-type-depth ${options.compositeTypeDepth} --schema ./${parser.config.baseSchema}${options.previewFeature ? " --preview-feature" : ""}`);
    });
}
