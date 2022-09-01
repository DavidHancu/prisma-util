import chalk from 'chalk';
import ora from 'ora';
import MessageBuilder, { prismaCLITag, successTag } from '../messages.js';
import { fixConflicts, runPrismaCommand } from '../utils.js';
export default function command(program, parser) {
    // Match Prisma's format command
    program
        .command("format")
        .description("Format a Prisma schema.")
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
        await runPrismaCommand(`format --schema ./node_modules/.bin/generated-schema.prisma${options.previewFeature ? " --preview-feature" : ""}`);
    });
}
