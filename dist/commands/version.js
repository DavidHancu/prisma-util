import chalk from "chalk";
import MessageBuilder from "../messages.js";
import { runPrismaCommand } from "../utils.js";
export default function command(program, parser) {
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
}
