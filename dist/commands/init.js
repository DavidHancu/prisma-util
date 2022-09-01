import chalk from "chalk";
import * as commander from "commander";
import { error } from "../logger.js";
import MessageBuilder from "../messages.js";
import { runPrismaCommand } from "../utils.js";
function verifyDatasourceProvider(provider, dummyPrevious) {
    const allowed = ['sqlite', 'postgresql', 'mysql', 'sqlserver', 'mongodb', 'cockroachdb'];
    if (!allowed.includes(provider)) {
        error(`Provider ${chalk.bold(`${provider}`)} is invalid or not supported. Try again with "postgresql", "mysql", "sqlite", "sqlserver", "mongodb" or "cockroachdb".`);
        throw new commander.InvalidArgumentError(`Provider ${chalk.bold(`${provider}`)} is invalid or not supported. Try again with "postgresql", "mysql", "sqlite", "sqlserver", "mongodb" or "cockroachdb".`);
    }
    return provider;
}
export default function command(program, parser) {
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
                .withSection("Examples", [chalk.gray("Set up a new Prisma project with PostgreSQL (default)"), `${chalk.gray("$")} prisma-util init`, "",
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
}
