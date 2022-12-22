import chalk from "chalk";
import { error, interactive } from "./logger.js";
import gradient from "gradient-string";
import MessageBuilder from "./messages.js";
import ora from "ora";
import inquirer from "inquirer";
import GitCreator, { ROOT } from './lib/git.js';
import * as fs from 'fs/promises';
import { convertPathToLocal } from "./utils.js";
import * as child_process from 'child_process';

type Text = string | {
    color: string;
    text: string;
};

type AssetPath = `${string} as ${string}` | `mkdir ${string}`;

type TutorialStep = ({
    type: "editFile";
    path: string;
} | {
    type: "removeFile";
    path: string;
} | {
    type: "command";
    allowedCommand: string;
    displayPath: string;
    changeEnv: NodeJS.ProcessEnv
}) & {
    text: Text[][];
};

type TutorialManifest = {
    $manifest: {
        assets: AssetPath[];
    };
    steps: TutorialStep[];   
};

export default class InteractiveMode {
    private example: string;
    private git: ReturnType<typeof GitCreator>;
    private manifest?: TutorialManifest;
    constructor(example?: string)
    {
        console.clear();
        this.example = example ? example : "";
        this.git = GitCreator(ROOT);

        const builder = new MessageBuilder()
            .withHeader(gradient.passion("Interactive Mode"))
            .withTitle(chalk.gray("This mode allows you to follow step-by-step tutorials using the CLI."));

        if(!example)
        {
            builder
                .withNewLine()
                .withSection(gradient.passion("How to start?"), [
                    `${chalk.gray("Run a tutorial from the Documentation")}`, `${chalk.gray("$")} prisma-util interactive --tutorial <link>`, "",
                    `${chalk.gray("See a list of available tutorials")}`, `https://prisma-util.gitbook.io/stable/interactive#Tutorials`
                ], true)
                .show()
            return;
        }

        builder.show();

        this.queue();
    }

    async queue()
    {
        const manifest = await this.git.File.get<TutorialManifest>("examples", `${this.example}.json`);
        if(manifest === undefined)
        {
            new MessageBuilder()
                .withHeader(gradient.passion("Tutorial Error"))
                .withTitle(chalk.gray("There has been an error while trying to fetch the tutorial manifest."))
                .show();
            return;
        };
        this.manifest = manifest;

        const res = await inquirer.prompt({
            type: "confirm",
            name: "run",
            message: chalk.gray("This tutorial will download files and install packages to this directory.\nDo you agree to run this example?"),
            prefix: gradient.passion("?"),
        });
        if(res.run)
        {
            console.log();
            await this.download();

            return;
        }

        this.end();
    }

    async download()
    {
        const spinner = ora({
            text: chalk.gray("Hang on while we set everything up for this tutorial...\nThe console output will be cleared once everything is ready.\n"),
            spinner: {
                "interval": 80,
                "frames": [
                    gradient.passion("⠋"),
                    gradient.passion("⠙"),
                    gradient.passion("⠹"),
                    gradient.passion("⠸"),
                    gradient.passion("⠼"),
                    gradient.passion("⠴"),
                    gradient.passion("⠦"),
                    gradient.passion("⠧"),
                    gradient.passion("⠇"),
                    gradient.passion("⠏")
                ]
            }
        });
        spinner.start();

        if(!this.manifest)
        {
            spinner.stop();
            this.end();

            return;
        }

        for(const asset of this.manifest.$manifest.assets)
        {
            if(asset.startsWith("mkdir"))
            {
                await fs.mkdir(asset.split("mkdir ")[1], { recursive: true });
            } else
            {
                const pathParts = asset.split(" as ");
                await fs.writeFile(convertPathToLocal(pathParts[1]), await this.git.File.get("examples", pathParts[0]) ?? "");
            }
        }

        spinner.stop();
        
        await this.emptyLoop();
    }

    async emptyLoop()
    {
        let i = -1;
        let currentStep = 0;
        let stepIteration = 0;

        if(!this.manifest)
        {
            return;
        }

        let err: string | null = null;

        while(true)
        {
            i++;
            this.clearWindow();

            console.log("\n");

            if(currentStep >= this.manifest.steps.length)
            {
                new MessageBuilder()
                    .withTitle(`${chalk.gray("This tutorial has been finished. You may only run")} ${gradient.passion(".exit")} ${chalk.gray("and")} ${gradient.passion(".cleanup")}${chalk.gray(".")}`)
                    .show();
                const res = await inquirer.prompt({
                    type: "input",
                    name: `run_command_${i}`,
                    prefix: gradient.passion("$"),
                    message: chalk.gray("root:"),
                });
                switch(res[`run_command_${i}`])
                {
                    case '.exit':
                        this.end();
                        process.exit(0);
                        break;
                    case '.cleanup':
                        if(this.manifest)
                        {
                            for(const file of this.manifest.$manifest.assets)
                            {
                                try {
                                    if(file.startsWith("mkdir"))
                                    {
                                        await fs.rmdir(file.split("mkdir ")[1]);
                                    } else
                                    {
                                        const as = file.split(" as ")[1];
                                        await fs.rm(as);
                                    }
                                } catch {}
                            }
                        }
                        this.end();
                        process.exit(0);
                        break;
                }
                continue; 
            }

            const step = this.manifest.steps[currentStep];

            let builder = new MessageBuilder()
                .withHeader(gradient.passion(`Interactive Mode (Step ${currentStep + 1} / ${this.manifest.steps.length})`));
            for(const lines of step.text)
            {
                const text = lines.map(line => {
                    return typeof line == "string" ? chalk.gray(line) : (
                        line.color == "passion" ? gradient.passion(line.text) : (chalk as any)[line.color](line.text));
                }).join("");
                builder = builder.withTitle(text);
            }
            builder.show();
            if(err)
            {
                error(err, "\n");
            }

            switch(step.type)
            {
                case 'removeFile':
                    const removeRes = await inquirer.prompt({
                        type: "confirm",
                        name: `confirm_${currentStep}_${stepIteration}`,
                        message: chalk.gray("Have you removed the file according to the tutorial?"),
                        prefix: gradient.passion("?"),
                    });
                    if(removeRes[`confirm_${currentStep}_${stepIteration}`])
                    {
                        try {
                            await fs.access(step.path);
                            err = `The ${chalk.bold(step.path)} file is still present.`;
                        } catch {
                            err = null;
                            currentStep++;
                            stepIteration = 0;
                        }
                    } else
                    {
                        stepIteration++;
                    }
                    break;
                case 'editFile':
                    const editRes = await inquirer.prompt({
                        type: "confirm",
                        name: `confirm_${currentStep}_${stepIteration}`,
                        message: chalk.gray("Have you edited the file according to the tutorial?"),
                        prefix: gradient.passion("?"),
                    });
                    if(editRes[`confirm_${currentStep}_${stepIteration}`])
                    {
                        err = null;
                        currentStep++;
                        stepIteration = 0;
                    } else
                    {
                        stepIteration++;
                    }
                    break;
                case 'command':
                    const res = await inquirer.prompt({
                        type: "input",
                        name: `run_command_${currentStep}_${stepIteration}`,
                        prefix: gradient.passion("$"),
                        message: chalk.gray(`${step.displayPath}:`),
                    });
                    const command = res[`run_command_${currentStep}_${stepIteration}`];
                    switch(command)
                    {
                        case '.exit':
                            this.end();
                            process.exit(0);
                            break;
                        case '.cleanup':
                            if(this.manifest)
                            {
                                for(const file of this.manifest.$manifest.assets)
                                {
                                    try {
                                        if(file.startsWith("mkdir"))
                                        {
                                            await fs.rmdir(file.split("mkdir ")[1]);
                                        } else
                                        {
                                            const as = file.split(" as ")[1];
                                            await fs.rm(as);
                                        }
                                    } catch {}
                                }
                            }
                            this.end();
                            process.exit(0);
                            break;
                        default:
                            if(command == step.allowedCommand)
                            {
                                await this.runCommand(command, step.changeEnv);
                                err = null;
                                currentStep++;
                                stepIteration = 0;
                            } else
                            {
                                stepIteration++;
                            }
                            break;
                    }
                    break;
            }
        }
    }

    async runCommand(command: string, env: NodeJS.ProcessEnv)
    {
        return new Promise<boolean>((resolve) => {
            // Spawn a child process running the command.
            const proc = child_process.spawn(command, {
                stdio: 'inherit',
                shell: true,
                env: {
                    ...process.env,
                    ...env
                }
            });
    
            proc.on("exit", (signal) => {
                // Resolve the promise on exit
                resolve(signal == 0);
            });
        })
    }

    clearWindow()
    {
        console.clear();
        this.printControls();
    }

    printControls()
    {
        new MessageBuilder()
            .withHeader(gradient.passion("Interactive Mode Controls"))
            .withTitle(chalk.gray(`At any time, type ${gradient.passion(".exit")} to exit the interactive mode.`))
            .withTitle(chalk.gray(`If you want to cleanup files as well as exit the interactive mode, type ${gradient.passion(".cleanup")}.`))
            .withNewLine()
            .withTitle(chalk.gray(`Any input that isn't a function specified above will be treated and executed as a command.`))
            .show();
    }

    end()
    {
        console.clear();
        new MessageBuilder()
            .withHeader(gradient.passion("Interactive Mode Ended"))
            .withTitle(chalk.gray(`This interactive mode session has ended.`))
            .show();
    }
}