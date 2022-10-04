import * as child_process from "child_process";
import * as path from "path";
import * as fs from "fs/promises";
import PrismaParser, { ConfigType } from "./parser.js";
import chalk from "chalk";
import { conflict, error, experimental, log, success } from './logger.js';
import { Command } from "commander";
import inquirer from "inquirer";
import { conflictTag } from "./messages.js";
import json5 from "json5";
import { pathToFileURL } from "url";

/** __dirname doesn't exist in type: module */
const __dirname = process.cwd();

/**Send commands to prisma. */
export function usePrisma(commandString: string) {
    return new Promise<void>((resolve) => {
        // Spawn a child process running the command.
        const proc = child_process.spawn(`npx --yes prisma ${commandString}`, {
            stdio: 'inherit',
            shell: true
        });

        proc.on("exit", (signal) => {
            // Resolve the promise on exit
            resolve();
        });
    })
}

/**Use the __dirname to create a local path (resides in project root). */
export function convertPathToLocal(p: string) {
    return path.resolve(__dirname, p);
}

/** Sub command helper */
export function createSubCommand(command: Command, nameAndArgs: string) {
    const subCommand = command.command(nameAndArgs);
    return subCommand;
}

/** Used to run commands with timings. */
export async function runPrismaCommand(command: string)
{
    // Measure execution time
    const start = process.hrtime();
    log(`${chalk.gray(`prisma ${command}`)}\n`, "\n")
    // Run Prisma command and pipe io
    const output = await usePrisma(command);
    const elapsed = process.hrtime(start)[1] / 1000000;
    // Print execution time and exit
    log(`${chalk.gray("Command executed in")} ${chalk.blue(process.hrtime(start)[0] + "s ")}${chalk.gray("and ")}${chalk.blue(elapsed.toFixed(2) + "ms")}${chalk.gray(".")}`, "\n");
    return output;
}

/** Create or read the config. */
export async function createConfig(configPath: string) {
    const path = convertPathToLocal(configPath);
    let json: ConfigType = {
        includeFiles: [],
        excludeModels: [],
        baseSchema: "",
        crossFileRelations: false,
        relations: {},
        extended: {},
        codeSchemas: false,
        codeGenerators: [],
        pgtrgm: false,
        ftsIndexes: {},
        schema: "",
        middleware: ""
    }
    try {
        json = (await import(pathToFileURL(path).toString())).default;
    } catch (err) {
        console.error(err);
        await fs.writeFile(path, `export default ${json5.stringify(json, null, 4)};`);
    }
    return json;
}

/**Load a .prisma file from the config. */
export async function getSchema(path: string) {
    try {
        return await fs.readFile(convertPathToLocal(path), "utf-8");
    } catch (err) {
        error(`The ${chalk.bold(path)} schema file doesn't exist!`);
        process.exit(1);
    }
}

/** Flatten array of arrays. */
export function flatten(array: any[][]): any[] {
    return array.reduce(function (flatArray, arrayToFlatten) {
      return flatArray.concat(Array.isArray(arrayToFlatten) ? flatten(arrayToFlatten) : arrayToFlatten);
    }, []);
}

/** Ends with any string in array. */
export function endsWithAny(item: string, array: string[])
{
    let returnValue = null;
    for(const test of array) {
        if(item.toLowerCase().endsWith(test.toLowerCase()))
        {
            returnValue = test;
            break;
        }
    };
    return returnValue;
}

/**Write temp file so prisma can read it. */
export async function writeTempSchema(content: string, path?: string)
{
    try {
        await fs.writeFile(convertPathToLocal(path ? path : "./node_modules/.bin/generated-schema.prisma"), content);
    } catch(err) {
        error("An error has occured while writing the generated schema.");
        console.error(err);
        process.exit(1);
    }
}