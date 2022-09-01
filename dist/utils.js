import * as child_process from "child_process";
import * as path from "path";
import * as fs from "fs/promises";
import chalk from "chalk";
import { conflict, error, experimental, log, success } from './logger.js';
import inquirer from "inquirer";
import { conflictTag } from "./messages.js";
/** __dirname doesn't exist in type: module */
const __dirname = process.cwd();
/**Send commands to prisma. */
export function usePrisma(commandString) {
    return new Promise((resolve) => {
        // Spawn a child process running the command.
        child_process.spawn(`npx --yes prisma ${commandString}`, {
            stdio: "inherit",
            shell: true
        }).on("exit", (signal) => {
            // Resolve the promise on exit
            resolve();
        });
    });
}
/**Use the __dirname to create a local path (resides in project root). */
export function convertPathToLocal(p) {
    return path.resolve(__dirname, p);
}
/** Sub command helper */
export function createSubCommand(command, nameAndArgs) {
    const subCommand = command.command(nameAndArgs);
    return subCommand;
}
/** Conflict questioner. */
export async function fixConflicts(parser, iterationCount = 0) {
    return new Promise(async (resolve) => {
        let conflicts = parser.getConflicts();
        if (conflicts.length == 0) {
            success("All conflicts resolved, proceeding with command.", "\n");
            resolve();
        }
        else {
            if (iterationCount == 0)
                conflict("Conflicts detected, please answer the questions below.", "\n");
            const conflictNow = conflicts[0];
            // Both should be the same
            const referred1 = parser.getReferredRelations(conflictNow[1]);
            const referred2 = parser.getReferredRelations(conflictNow[2]);
            if ((referred1.length > 0 || referred2.length > 0) && !parser.config.crossFileRelations) {
                error(`Cross-file relations are not enabled in ${chalk.bold(parser.configPath)}.\n`, `\n`);
                process.exit(1);
            }
            // Try to fix with config file
            const canMap = {
                1: false,
                2: false
            };
            referred1.forEach((ref) => {
                const res = parser.canFixCrossFileWithMapper(`${ref.model}.${ref.column.name}`);
                if (res) {
                    parser.suggest(conflictNow[1], {
                        type: "remap",
                        from: `${ref.model}.${ref.column.name}`,
                        to: res
                    });
                    canMap[1] = conflictNow[1] == res;
                    canMap[2] = conflictNow[2] == res;
                }
            });
            // If there is another one, ask the user for help
            const canMapAny = canMap[1] || canMap[2];
            if (canMapAny) {
                const mapper = canMap[1] ? conflictNow[1] : conflictNow[2];
                const other = canMap[1] ? conflictNow[2] : conflictNow[1];
                experimental(`The ${chalk.bold("Automatic Mapper")} can't process a conflict automatically.\n`, "\n");
                const answers = await inquirer.prompt({
                    name: `resolver_${iterationCount}`,
                    type: 'list',
                    prefix: conflictTag,
                    message: chalk.gray(`Review your schema, then choose an option to solve the conflict.\n\n${chalk.magenta(mapper)} is referenced in your configuration file as the replacement for another model.\nHowever, ${chalk.magenta(other)} has the same model name as the generated one would.\nPlease choose one of the options below.\n\n${chalk.gray("Your choice:")}`),
                    choices: [
                        `Skip ${chalk.magenta(other)}`,
                        `Rename ${chalk.magenta(other)}`,
                    ],
                });
                const answer = answers[`resolver_${iterationCount}`].replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, "");
                switch (answer) {
                    case `Skip ${other}`:
                        parser.suggest(other, { type: "skip" });
                        break;
                    case `Rename ${other}`:
                        const name1 = (await inquirer.prompt({
                            name: `resolver_rename_${iterationCount}`,
                            type: 'input',
                            prefix: conflictTag,
                            message: chalk.gray(`What is the new name for ${chalk.magenta(other)}?`),
                        }))[`resolver_rename_${iterationCount}`];
                        parser.suggest(other, {
                            type: "rename",
                            newName: name1
                        });
                        break;
                }
                resolve(fixConflicts(parser, iterationCount + 1));
                return;
            }
            // Show never be shown unless the json is parsed incorrectly
            const warningText = canMap[1] && canMap[2] ? `${chalk.yellow("Warning: ")}Both ${chalk.magenta(conflictNow[1])} and ${chalk.magenta(conflictNow[2])} are mapping the same column.\n\n` : "";
            console.log();
            const answers = await inquirer.prompt({
                name: `resolver_${iterationCount}`,
                type: 'list',
                prefix: conflictTag,
                message: chalk.gray(`Review your schema, then choose an option to solve the conflict.\n\nTwo models have the same name, please select an action.\n${chalk.magenta(conflictNow[1])} and ${chalk.magenta(conflictNow[2])}\n\n${warningText}${chalk.gray("Your choice:")}`),
                choices: [
                    `Skip ${chalk.magenta(conflictNow[1])}`,
                    `Skip ${chalk.magenta(conflictNow[2])}`,
                    `Rename ${chalk.magenta(conflictNow[1])}`,
                    `Rename ${chalk.magenta(conflictNow[2])}`,
                ],
            });
            // remove colors
            const answer = answers[`resolver_${iterationCount}`].replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, "");
            switch (answer) {
                case `Skip ${conflictNow[1]}`:
                    parser.suggest(conflictNow[1], { type: "skip" });
                    break;
                case `Skip ${conflictNow[2]}`:
                    parser.suggest(conflictNow[2], { type: "skip" });
                    break;
                case `Rename ${conflictNow[1]}`:
                    const name1 = (await inquirer.prompt({
                        name: `resolver_rename_${iterationCount}`,
                        type: 'input',
                        prefix: conflictTag,
                        message: chalk.gray(`What is the new name for ${chalk.magenta(conflictNow[1])}?`),
                    }))[`resolver_rename_${iterationCount}`];
                    parser.suggest(conflictNow[1], {
                        type: "rename",
                        newName: name1
                    });
                    break;
                case `Rename ${conflictNow[2]}`:
                    const name2 = (await inquirer.prompt({
                        name: `resolver_rename_${iterationCount}`,
                        type: 'input',
                        prefix: conflictTag,
                        message: chalk.gray(`What is the new name for ${chalk.magenta(conflictNow[2])}?`),
                    }))[`resolver_rename_${iterationCount}`];
                    parser.suggest(conflictNow[2], {
                        type: "rename",
                        newName: name2
                    });
                    break;
            }
            resolve(fixConflicts(parser, iterationCount + 1));
        }
    });
}
/** Used to run commands with timings. */
export async function runPrismaCommand(command) {
    // Measure execution time
    const start = process.hrtime();
    log(`${chalk.gray(`prisma ${command}`)}\n`, "\n");
    // Run Prisma command and pipe io
    await usePrisma(command);
    const elapsed = process.hrtime(start)[1] / 1000000;
    // Print execution time and exit
    log(`${chalk.gray("Command executed in")} ${chalk.blue(process.hrtime(start)[0] + "s ")}${chalk.gray("and ")}${chalk.blue(elapsed.toFixed(2) + "ms")}${chalk.gray(".")}`, "\n");
}
/** Create or read the config. */
export async function createConfig(configPath) {
    const path = convertPathToLocal(configPath);
    let json = {
        includeFiles: [],
        excludeModels: [],
        baseSchema: "",
        crossFileRelations: false,
        relations: {},
        extended: {}
    };
    try {
        json = JSON.parse(await fs.readFile(path, "utf-8"));
    }
    catch (err) {
        await fs.writeFile(path, JSON.stringify(json, null, 4));
    }
    return json;
}
/**Load a .prisma file from the config. */
export async function getSchema(path) {
    try {
        return await fs.readFile(convertPathToLocal(path), "utf-8");
    }
    catch (err) {
        error(`The ${chalk.bold(path)} schema file doesn't exist!`);
        process.exit(1);
    }
}
/** Flatten array of arrays. */
export function flatten(array) {
    return array.reduce(function (flatArray, arrayToFlatten) {
        return flatArray.concat(Array.isArray(arrayToFlatten) ? flatten(arrayToFlatten) : arrayToFlatten);
    }, []);
}
/** Ends with any string in array. */
export function endsWithAny(item, array) {
    let returnValue = null;
    for (const test of array) {
        if (item.toLowerCase().endsWith(test.toLowerCase())) {
            returnValue = test;
            break;
        }
    }
    ;
    return returnValue;
}
/**Write temp file so prisma can read it. */
export async function writeTempSchema(content, path) {
    try {
        await fs.writeFile(convertPathToLocal(path ? path : "./node_modules/.bin/generated-schema.prisma"), content);
    }
    catch (err) {
        error("An error has occured while writing the generated schema.");
        console.error(err);
        process.exit(1);
    }
}
