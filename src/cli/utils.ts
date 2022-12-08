import * as child_process from "child_process";
import * as path from "path";
import * as fs from "fs/promises";
import PrismaParser, { ConfigType, OptionalFeaturesArray } from "./parser.js";
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

/**
 * Normalize path according to the project root.
 * @param path The path to normalize.
 */
export function normalizePath(p: string) {
    return path.relative(__dirname, p);
}

/**
 * Get configuration path.
 */
export async function getConfigurationPath(configPath: string)
{
    const packConfig = JSON.parse(await fs.readFile(convertPathToLocal("./package.json"), "utf8"));
    const folder = packConfig.prismaUtil ? packConfig.prismaUtil : "prisma-util";
    configPath = configPath == "<DEF>" ? (packConfig.prismaUtilConfig ? packConfig.prismaUtilConfig : "config.mjs") : "config.mjs";
    const p = convertPathToLocal(path.join(folder, configPath));

    return p;
}

/**
 * Utility function to Walk a directory.
 * @param directory The directory to search.
 * @returns A flattened array of paths.
 */
export async function getFiles(directory: string): Promise<string[]> {
    const dirents = await fs.readdir(directory, { withFileTypes: true });
    const files = await Promise.all(dirents.map((dirent) => {
      const res = path.join(directory, dirent.name);
      return dirent.isDirectory() ? getFiles(res) : res;
    }));
    return Array.prototype.concat(...files);
}

/** Create or read the config. */
export async function createConfig(configPath: string) {
    const packConfig = JSON.parse(await fs.readFile(convertPathToLocal("./package.json"), "utf8"));
    const folder = packConfig.prismaUtil ? packConfig.prismaUtil : "prisma-util";
    configPath = configPath == "<DEF>" ? (packConfig.prismaUtilConfig ? packConfig.prismaUtilConfig : "config.mjs") : "config.mjs";
    const p = convertPathToLocal(path.join(folder, configPath));
    let created = false;
    try {
        await fs.access(p, fs.constants.R_OK);
    } catch(_)
    {
        created = true;
    }
    let json: ConfigType = {
        optionalFeatures: [],
        includeFiles: [],
        baseSchema: "",
        toolchain: {
            useExtensions: false,
            resolve: {
                types: "./types"
            }
        }
    }
    let textToWrite = "";
    try {
        textToWrite = (await fs.readFile(p, "utf8")).replace(/@typedef {".*} OptionalFeatures/gms, `@typedef {${OptionalFeaturesArray.map(feature => `"${feature}"`).join(" | ")}} OptionalFeatures`);
        json = (await import(pathToFileURL(p).toString())).default;
        if(configPath == "<DEF>" && (!packConfig.prismaUtilConfig || !packConfig.prismaUtil))
        {
            packConfig.prismaUtil = folder;
            packConfig.prismaUtilConfig = configPath;
            await fs.writeFile(convertPathToLocal("package.json"), JSON.stringify(packConfig, null, 2));
        }
    } catch (err) {
        if(created)
        {
            textToWrite = 
`// @ts-check

/**
* @typedef {string | ((generator?: any) => string)} FileGeneratorConfig
* @typedef {string | ((model?: any, name?: any) => string)} FileModelConfig
* @typedef {${OptionalFeaturesArray.map(feature => `"${feature}"`).join(" | ")}} OptionalFeatures
*/

/**
 * @typedef {Object} IntrospectionModel
 * 
 * @property {String} name
 * The name of this model. If this parameter hasn't been modified before, it will be the table name from the database.
 * 
 * @property {(attribute: string) => void} addAttribute
 * Add an attribute to this model.
 * 
 * attribute - The attribute to add. You can use the \`schema-creator\` module for a list of attributes.
 */

/**
 * @typedef {Object} ResolveConfiguration
 * 
 * @property {String} types
 * Path to the types folder relative to the folder specified in \`package.json\`.
 * To find out more about configuring the types folder, read {@link https://prisma-util.gitbook.io/prisma-util/modules/project-toolchain/api-documentation#types this} documentation section. 
*/

/**
 * @typedef {Object} ProjectToolchainConfiguration
 * 
 * @property {boolean} useExtensions
 * Whether Project Toolchain should use client extensions or middleware.
 * To find out more about configuring extension usage, read {@link https://prisma-util.gitbook.io/prisma-util/modules/project-toolchain/api-documentation#use-extensions this} documentation section. 
 * 
 * @property {ResolveConfiguration} resolve
 * Help Project Toolchain resolve your assets correctly.
 * To find out more about configuring resolve roots, read {@link https://prisma-util.gitbook.io/prisma-util/modules/project-toolchain/api-documentation#resolve this} documentation section. 
 * 
*/

/**
* @typedef {Object} Configuration
* 
* @property {FileModelConfig} baseSchema 
* The file that contains your generator and datasource. This path is relative to your project root.
* To find out more about configuring the base schema, read {@link https://prisma-util.gitbook.io/prisma-util/api-documentation/configuration-reference/base-schema this} documentation section.
* 
* @property {FileModelConfig[]} includeFiles
* Files in this array will be merged in to the final schema by Prisma Util. 
* To find out more about configuring the included files, read {@link https://prisma-util.gitbook.io/prisma-util/api-documentation/configuration-reference/include-files this} documentation section.
* 
* @property {string[]?} [excludeModels]
* This array uses the \`file:model\` association defined in the Prisma Util concepts. Models in this array will be excluded from the final build.
* To find out more about configuring the excluded models, read {@link https://prisma-util.gitbook.io/prisma-util/api-documentation/configuration-reference/exclude-models this} documentation section.
* 
* @property {OptionalFeatures[]} optionalFeatures
* Allows you to enable optional features to supercharge your Prisma Util setup.
* To find out more about configuring optional features, read {@link https://prisma-util.gitbook.io/prisma-util/api-documentation/configuration-reference/optional-features this} documentation section.
*
* @property {{[fileModel: string]: string}?} [extended]
* Create model inheritance within Prisma! The model defined by the value of this key-value entry will receive all non-id non-relation fields from the model defined by the key.
* To find out more about configuring model inheritance, read {@link https://prisma-util.gitbook.io/prisma-util/api-documentation/configuration-reference/extend-models this} documentation section.
*
* @property {ProjectToolchainConfiguration} toolchain
* Project toolchain configuration block.
* To find out more about configuring Project Toolchain, read {@link https://prisma-util.gitbook.io/prisma-util/api-documentation/configuration-reference/toolchain this} documentation section.
*/

/**
 * @type {Configuration}
 */
export default ${json5.stringify(json, null, 4)};`;
                    try {
                        await fs.mkdir(convertPathToLocal("prisma-util"));
                        await fs.mkdir(convertPathToLocal(path.join("prisma-util", "types")));
                        await fs.mkdir(convertPathToLocal(path.join("prisma-util", "functions")));
                        if(!packConfig.prismaUtil)
                        {
                            packConfig.prismaUtil = "prisma-util";
                            await fs.writeFile(convertPathToLocal("package.json"), JSON.stringify(packConfig, null, 2));
                        }
                        if(!packConfig.prismaUtilConfig)
                        {
                            packConfig.prismaUtilConfig = configPath;
                        }
                    } catch (e) {
                    }
        } else
        {
            error("The configuration file is invalid.", "\n");
            process.exit(1);
        }
    }
    await fs.writeFile(p, textToWrite);
    return {
        configData: json,
        created
    };
}

const regex = /(?:\{(?:<(.+?\.json)>)\.(.+?)\})/gms;
/**Use data from json files inside configuration. */
export async function matchJSON(s: string)
{
    const fileContentMap: {
        [file: string]: any
    } = {};
    for(let results; results = regex.exec(s);)
    {
        const file = results[1];
        if(!fileContentMap[file])
            fileContentMap[file] = JSON.parse(await fs.readFile(convertPathToLocal(file), "utf8"));
    }
    return s.replace(regex, (match, file, p2) => {
        const path = p2.split(".");
        let object = fileContentMap[file];
        for(const p of path)
            object = object[p];
        return object;
    });
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