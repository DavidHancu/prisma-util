import chalk from "chalk";
/**Premade message for the general help menu. */  
export const showIntro = () => {
    new MessageBuilder()
        .withHeader()
        .withTitle(chalk.gray("Prisma Util is an easy tool that helps with merging schema files and running utility commands."))
        .withTitle(`${chalk.gray("In the background, it uses")} ${chalk.blue("npx prisma")} ${chalk.gray("to run commands, and as such the parameters are the same.")}`)
        .withNewLine()
        .withSection("Usage", [`${chalk.gray("$")} prisma-util [command]`])
        .withSection("Commands", [
            ` ${chalk.gray("prepare")}   Initiate a simple Prisma Util configuration file.`,
            `    ${chalk.gray("init")}   Set up Prisma for your app`, 
            `${chalk.gray("generate")}   Generate artifacts (e.g. Prisma Client)`, 
            `      ${chalk.gray("db")}   Manage your database schema and lifecycle`, 
            ` ${chalk.gray("migrate")}   Migrate your database`, 
            `  ${chalk.gray("studio")}   Browse your data with Prisma Studio`, 
            `  ${chalk.gray("format")}   Format your schema`,
            `  ${chalk.gray("schema")}   Generate schemas using Prisma Util without running additional commands`,
            ` ${chalk.gray("upgrade")}   Migrate your configuration to the latest version`])
        .withSection("Flags", [`${chalk.gray("--preview-feature")}   Run Preview Prisma commands`])
        .withSection("Examples", 
            [   `${chalk.gray("Set up a new Prisma project")}`, `${chalk.gray("$")} prisma-util init`, "", 
                `${chalk.gray("Generate artifacts (e.g. Prisma Client)")}`, `${chalk.gray("$")} prisma-util generate`, "",
                `${chalk.gray("Browse your data")}`, `${chalk.gray("$")} prisma-util studio`, "",
                `${chalk.gray("Create migrations from your Prisma schema, apply them to the database, generate artifacts (e.g. Prisma Client)")}`, `${chalk.gray("$")} prisma-util migrate dev`, "",
                `${chalk.gray("Pull the schema from an existing database, updating the Prisma schema")}`, `${chalk.gray("$")} prisma-util db pull`, "",
                `${chalk.gray("Push the Prisma schema state to the database")}`, `${chalk.gray("$")} prisma-util db push`
            ])
        .show();
}
/**Little utility to create nice messages. */  
export default class MessageBuilder {
    text: string;
    constructor ()
    {
        this.text = "";
    }

    withHeader() {
        this.text += `\n${chalk.bold(chalk.blue("Prisma Util"))}\n\n`;
        return this;
    }

    withTitle(title: string) {
        this.text += `  ${title}\n`;
        return this;
    }

    withSection(title: string, items: string[])
    {
        this.text += `${chalk.bold(chalk.blue(title))}\n\n`;
        items.forEach((item) => {
            this.text += `  ${item}\n`;
        });
        this.text += "\n";
        return this;
    }

    withNewLine() {
        this.text += `\n`;
        return this;
    }

    show() {
        console.log(`${this.text}`);
    }
}

export const prismaCLITag = chalk.black.bold.bgBlue(" PRISMA UTIL ");
export const errorTag = chalk.black.bold.bgRed(" ERROR ");
export const warningTag = chalk.black.bold.bgYellow(" WARNING ");
export const conflictTag = chalk.black.bold.bgMagenta(" CONFLICT ");
export const successTag = chalk.black.bold.bgGreen(" SUCCESS ");
export const experimentalTag = chalk.black.bold.bgWhite(" EXPERIMENTAL ");
export const updateTag = chalk.bold.black.bgCyan(" UPDATE ");