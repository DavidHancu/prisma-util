import chalk from 'chalk';
import ora from 'ora';
import MessageBuilder, { prismaCLITag, successTag } from '../messages.js';
import { fixConflicts, runPrismaCommand } from '../utils.js';
export default function command(program, parser) {
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
        await fixConflicts(parser);
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
    });
}
