import AbstractCreator from "./creator.js";
import Enum from "./enum.js";
import Model from "./model.js";
import glob from "glob";
import * as child_process from 'child_process';
import * as fs from 'fs/promises';
import { matchJSON } from "../cli/utils.js";
import path from "path";
import { pathToFileURL } from "url";

/** Allows schema creation via code. */
export class SchemaCreator extends AbstractCreator {
    /** Models that will be generated */
    private models: Model[];
    /** Enums that will be generated */
    private enums: Enum[];

    /** Singleton pattern. */
    private static instance: SchemaCreator;

    private constructor() {
        super();
        this.models = [];
        this.enums = [];
    }

    /** Internal method for assigning creators. */
    private static getInstance()
    {
        if (!SchemaCreator.instance) {
            SchemaCreator.instance = new SchemaCreator();
        }

        return SchemaCreator.instance;
    }

    /** Method to push models. You should not use this manually, as it's handled internally. */
    pushModel(model: Model) {
        this.models.push(model);
        return this;
    }

    /** Method to push enums. You should not use this manually, as it's handled internally. */
    pushEnum(e: Enum) {
        this.enums.push(e);
        return this;
    }

    /** Create a new model. */
    static model(name: string)
    {
        return new Model(this.getInstance(), name);
    }

    /** Create a new enum. */
    static enum(name: string)
    {
        return new Enum(this.getInstance(), name);
    }

    /** Build the schema into a string that can be parsed. */
    static build()
    {
        return this.getInstance().build();
    }

    model(name: string): Model {
        return new Model(this, name);
    }

    enum(name: string): Enum {
        return new Enum(this, name);
    }

    build(): string {
        let schema = "";
        for(let model of this.models)
        {
            model = model.beforeBuild();
            let columns = model.columns.map(column => `  ${column.name} ${column.type} ${column.constraints.join(" ")}`).join("\n");
            schema = `${schema}\n\nmodel ${model._name} {\n${columns}\n}`;
        }
        for(let en of this.enums)
        {
            en = en.beforeBuild();
            schema = `${schema}\n\nenum ${en._name} {\n  ${en.items.join("\n  ")}\n}`;
        }
        return schema;
    }
}

/** Utility for including files using glob. 
 * Will always return an array of {@link https://prisma-util.gitbook.io/prisma-util/api-documentation#path Path}s.
*/
export function globModels(base: (((model?: string, column?: string) => string) | string), globPattern = "**/*.prisma")
{
    const baseSchema = typeof base == "function" ? base() : base;
    return glob.sync(globPattern, {
        ignore: "node_modules/**/*"
    }).filter(path => path != baseSchema);
}

/**
 * Utility for running commands in migration hooks.
 * This function will return a Promise that resolves when the command has finished execution.
 */
export function execCommand(command: string)
{
    return new Promise<void>((resolve) => {
        // Spawn a child process running the command.
        const proc = child_process.spawn(command, {
            stdio: 'inherit',
            shell: true
        });

        proc.on("exit", (signal) => {
            // Resolve the promise on exit
            resolve();
        });
    })
}

/**
 * Utility for defining a function folder.
 * 
 * This function will return an array of functions.
 */
export async function functionsFolder(folderPath: string)
{
    const p = await matchJSON(folderPath);

    const functions: {
        [name: string]: Function
    } = {};
    const files = (await fs.readdir(p));
    for(const file of files)
    {
        const entries = Object.entries((await import(pathToFileURL(path.join(p, file)).toString())));
        for(const entry of entries)
        {
            const [name, func] = entry as [string, Function];
            if(!functions[name])
                functions[name] = func;
        }
    }
    
    return Object.values(functions);
}

import * as dotenv from "dotenv";

/**
 * Import an .env file to the Virtual Environment.
 * @param path Path relative to your project root pointing to the env file that needs to be imported.
 */
export function useEnv(path: string)
{
    dotenv.config({ path: path, override: true });
}

/** Utility for easier file:model.column associations. */
export function constantModel(path: string) {
    /** 
     * Utility for easier file:model.column associations.
     * 
     * Not providing a model will return a  {@link https://prisma-util.gitbook.io/prisma-util/api-documentation#path Path}.
     * 
     * Providing a model will return a {@link https://prisma-util.gitbook.io/prisma-util/api-documentation#file-model FileModel}.
     * 
     * Providing both a model and a column will return a {@link https://prisma-util.gitbook.io/prisma-util/api-documentation#file-model-column FileModelColumn}.
     */
    return function(model?: string, column?: string)
    {
        if(model)
        {
            if(column)
            {
                return `${path}:${model}.${column}`;
            }
            return `${path}:${model}`;
        }
        return path;
    }
}

/** Utility for easier file:generator associations. */
export function constantGenerator(path: string) {
    /** 
     * Utility for easier file:generator associations.
     * 
     * Not providing a generator will return a  {@link https://prisma-util.gitbook.io/prisma-util/api-documentation#path Path}.
     * 
     * Providing a generator will return a {@link https://prisma-util.gitbook.io/prisma-util/api-documentation#file-generator FileGenerator}.
     * 
     */
    return function(generator?: string)
    {
        if(generator)
        {
            return `${path}:${generator}`;
        }
        return path;
    }
}

/** Utility for importing types inside of JavaScript. */
export function importType(path: string, typeName: string) {
    return `${path}:${typeName}`;
}

/** Utility function for accessing environment variables. */
export function env(variable: string, def?: string): string {
    let returnValue = process.env[variable];
    if(returnValue)
        return returnValue;
    return def ? def : "";
}

type ReferentialAction = "Cascade" | "NoAction" | "Restrict" | "SetDefault" | "SetNull";

/** Constraints that you can add to your columns and models. */
export const Constraints = {
    /** These constraints can be used anywhere. */
    DB: (method: string, ...args: string[]) => `@db.${method}${args.length > 0 ? `(${args.join(", ")})` : ""}`,
    /** These constraints can only be applied to columns. */
    Column: {
        /** Defines a single-field ID on the model. */
        ID: (args?: {
            map?: string, length?: number, sort?: string, clustered?: boolean
        }) => args ? `@id(${Object.entries(args).map(pair => `${pair[0]}: ${typeof pair[1] == "string" ? `"${pair[1]}"` : pair[1]}`).join(", ")})` : "@id",
        /** Defines a default value for a field. */
        DEFAULT: (value: string, args?: {
            map?: string
        }) => args ? `@default(${value}${args ? `, map: "${args.map}"` : ""})` : `@default(${value})`,
        /** Defines a unique constraint for this field. */
        UNIQUE: (args?: {
            map?: string, length?: number, sort?: string, clustered?: boolean
        }) => args ? `@unique(${Object.entries(args).map(pair => `${pair[0]}: ${typeof pair[1] == "string" ? `"${pair[1]}"` : pair[1]}`).join(", ")})` : "@unique",
        /** Defines meta information about the relation */
        RELATION: (args: {
            name?: string,
            fields: string[],
            references: string[], onDelete?: ReferentialAction, onUpdate?: ReferentialAction, map?: string
        }) => `@relation(${Object.entries(args).map(pair => `${pair[0]}: ${typeof pair[1] == "string" ? `"${pair[1]}"` : `[${pair[1].join(", ")}]`}`).join(", ")})`,
        /** Maps a field name or enum value from the Prisma schema to a column or document field with a different name in the database. If you do not use @map, the Prisma field name matches the column name or document field name exactly. */
        MAP: (name: string) => `@map("${name}")`,
        /** Automatically stores the time when a record was last updated. If you do not supply a time yourself, the Prisma Client will automatically set the value for fields with this attribute. */
        UPDATEDAT: () => "@updatedAt",
        /** In 2.17.0 and later, Prisma adds @ignore to fields that refer to invalid models when you introspect. */
        IGNORE: () => "@ignore"
    },
    /** These constraints can only be applied to models. */
    Model: {
        /** Defines a multi-field ID on the model. */
        ID: (fields: string[], args?: {
            map?: string, length?: number, sort?: string, clustered?: boolean
        }) => `@@id(fields: [${fields.join(", ")}]${args ? `${Object.entries(args).length > 0 ? ", " : ""}${Object.entries(args).map(pair => `${pair[0]}: ${typeof pair[1] == "string" ? `"${pair[1]}"` : pair[1]}`).join(", ")}` : ""})`,
        /** Defines a compound unique constraint  for the specified fields. */
        UNIQUE: (fields: string[], args?: {
            map?: string, length?: number, sort?: string, clustered?: boolean
        }) => `@@unique(fields: [${fields.join(", ")}]${args ? `${Object.entries(args).length > 0 ? ", " : ""}${Object.entries(args).map(pair => `${pair[0]}: ${typeof pair[1] == "string" ? `"${pair[1]}"` : pair[1]}`).join(", ")}` : ""})`,
        /** Defines an index in the database. */
        INDEX: (fields: string[], args?: {
            name?: string, type?: string, map?: string, length?: number, sort?: string, clustered?: boolean, ops?: string
        }) => `@@index(fields: [${fields.join(", ")}]${args ? `${Object.entries(args).length > 0 ? ", " : ""}${Object.entries(args).map(pair => `${pair[0]}: ${typeof pair[1] == "string" ? `"${pair[1]}"` : pair[1]}`).join(", ")}` : ""})`,
        /** Maps the Prisma schema model name to a table (relational databases) or collection (MongoDB) with a different name, or an enum name to a different underlying enum in the database. If you do not use @@map, the model name matches the table (relational databases) or collection (MongoDB) name exactly. */
        MAP: (name: string) => `@@map("${name}")`,
        /** In 2.17.0 and later, Prisma adds @@ignore to an invalid model instead of commenting it out. */
        IGNORE: () => "@@ignore"
    }
};

/** Functions that you can use in your constraints. */
export const Functions = {
    /** Represents default values that are automatically generated by the database. */
    AUTO: () => "auto()",
    /** Create a sequence of integers in the underlying database and assign the incremented values to the ID values of the created records based on the sequence. */
    AUTOINCREMENT: () => "autoincrement()",
    /** Create a sequence of integers in the underlying database and assign the incremented values to the values of the created records based on the sequence. */
    SEQUENCE: (argument?: "virtual" | {cache: number} | {increment: number} | {minValue: number} | {maxValue: number} | {start: number}) => argument ? `sequence(${argument == "virtual" ? "virtual": `${Object.keys(argument)[0]}: ${Object.values(argument)[0]}`})` : "sequence()",
    /** Generate a globally unique identifier based on the cuid spec.*/
    CUID: () => "cuid()",
    /** Generate a globally unique identifier based on the UUID spec.*/
    UUID: () => "uuid()",
    /** Set a timestamp of the time when a record is created. */
    NOW: () => "now()",
    /**Represents default values that cannot be expressed in the Prisma schema (such as random()). */
    DBGENERATED: (argument?: string) => `dbgenerated(${argument ? `"${argument}"` : ""})`
};