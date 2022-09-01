import { showIntro } from '../messages.js';
export default function command(program, parser) {
    // Default command for when no subcommands have been added
    program
        .command("help", { isDefault: true })
        .description("Help menu for Prisma Util.")
        .action(async () => {
        showIntro();
    });
}
