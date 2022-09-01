import PrismaParser, { ConfigType } from "./parser.js";
import { Command } from "commander";
/**Send commands to prisma. */
export declare function usePrisma(commandString: string): Promise<void>;
/**Use the __dirname to create a local path (resides in project root). */
export declare function convertPathToLocal(p: string): string;
/** Sub command helper */
export declare function createSubCommand(command: Command, nameAndArgs: string): Command;
/** Conflict questioner. */
export declare function fixConflicts(parser: PrismaParser, iterationCount?: number): Promise<void>;
/** Used to run commands with timings. */
export declare function runPrismaCommand(command: string): Promise<void>;
/** Create or read the config. */
export declare function createConfig(configPath: string): Promise<ConfigType>;
/**Load a .prisma file from the config. */
export declare function getSchema(path: string): Promise<string>;
/** Flatten array of arrays. */
export declare function flatten(array: any[][]): any[];
/** Ends with any string in array. */
export declare function endsWithAny(item: string, array: string[]): string | null;
/**Write temp file so prisma can read it. */
export declare function writeTempSchema(content: string, path?: string): Promise<void>;
