import * as child_process from "child_process";
import * as path from "path";
import * as fs from "fs/promises";
import chalk from "chalk";
import { error, log } from './logger.js';
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
