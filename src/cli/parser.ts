import chalk from "chalk";
import createSpinner from "ora";
import { warn, error, experimental, log, conflict } from "./logger.js";
import { successTag, prismaCLITag } from "./messages.js";
import { flatten, getSchema, endsWithAny, writeTempSchema, runPrismaCommand, convertPathToLocal, getConfigurationPath, getFiles } from "./utils.js";
import pluralize from "pluralize";
import * as fs from 'fs/promises';
import path from "path";
import { EditStrategy, GenerationToolchainInstance, IGNORE_SEARCH_STEP } from "./lib/toolchain/generation.js";
import { MiddlewareToolchainInstance } from "./lib/toolchain/middleware.js";
import json5 from "json5";
import { ExtensionsToolchainInstance } from "./lib/toolchain/extensions.js";
import { Constraints } from "../schema-creator/index.js";

type IntrospectionModel = {
    /** The name of this model. If this parameter hasn't been modified before, it will be the table name from the database. */
    name: string;
    /** Add an attribute to this model.
    * 
    * attribute - The attribute to add. You can use the `schema-creator` module for a list of attributes. */
    addAttribute: (attribute: string) => void;
}

/** Current Experimental features available with Prisma Util. */
export const OptionalFeaturesArray = <const>["crossFileRelations", "codeSchemas", "pgtrgm", "ignoreEmptyConditions", "customAttributeFunctions", "environmentLock", "virtualEnvironment", "middlewareContext", "deprecatedTag", "staticTake", "prismaGenerators", "refinedTypes", "enhancedIntrospection"];
export type OptionalFeatures = typeof OptionalFeaturesArray[number];

/**
 * Allow dynamic configuration generation.
 */
const configurationDocumentation: {
    [key in OptionalFeatures]: {
        name: string,
        required: boolean,
        type: string,
        description: string[]
    }[]
} = {
    enhancedIntrospection: [{
        name: "introspection",
        required: false,
        type: "{modelPatterns: {$static?: {[table: string]: string | ((model: IntrospectionModel) => Promise<IntrospectionModel>)}, $regex?: {[tableRegex: string]: ((model: IntrospectionModel, match: string, ...groups: string[]) => Promise<IntrospectionModel>)}}}",
        description: [
            "Enforce conditions on your model names",
            "To find out more about configuring introspection, read {@link https://prisma-util.gitbook.io/prisma-util/api-documentation/configuration-reference/introspection this} documentation section."
        ]
    }],
    refinedTypes: [{
        name: "fieldTypes",
        required: false,
        type: "{[fileModelColumn: string]: string}",
        description: [
            "Refine the types of model fields.",
            "To find out more about configuring refined types, read {@link https://prisma-util.gitbook.io/prisma-util/api-documentation/configuration-reference/field-types this} documentation section."
        ]
    }],
    prismaGenerators: [{
        name: "generators",
        required: false,
        type: "{include: FileGeneratorConfig[], run: {[key: string]: string | (() => Promise<boolean>) | boolean}}",
        description: [
            "Include generators that will be ran by Prisma.",
            "To find out more about configuring Prisma generators, read {@link https://prisma-util.gitbook.io/prisma-util/api-documentation/configuration-reference/generators this} documentation section."
        ]
    }],
    staticTake: [{
        name: "take",
        required: false,
        type: "{$global: number, [model: string]: number} | {[model: string]: number}",
        description: [
            "Set the default take amount for each model.",
            "To find out more about configuring take amounts, read {@link https://prisma-util.gitbook.io/prisma-util/api-documentation/configuration-reference/take this} documentation section."
        ]
    }],
    deprecatedTag: [{
        name: "deprecated",
        required: false,
        type: "{[fileModelColumn: string]: string}",
        description: [
            "Mark a field as deprecated. The value of this key-value pair represents the message shown in the client.",
            "To find out more about configuring deprecated fields, read {@link https://prisma-util.gitbook.io/prisma-util/api-documentation/configuration-reference/deprecated this} documentation section."
        ]
    }],
    virtualEnvironment: [{
        name: "environment",
        required: false,
        type: "() => Promise<void>",
        description: [
            "Configure the environment variables for Prisma.",
            "To find out more about configuring the virtual environment, read {@link https://prisma-util.gitbook.io/prisma-util/api-documentation/configuration-reference/environment this} documentation section."
        ]
    }],
    environmentLock: [],
    crossFileRelations: [{
        name: "relations",
        required: false,
        type: "{[fileModelColumn: string]: string}",
        description: [
            "Indicate a cross-file relation between the column defined by the key of this key-value entry and the model defined by the value.",
            "To find out more about configuring cross-file relations, read {@link https://prisma-util.gitbook.io/prisma-util/api-documentation/configuration-reference/relations this} documentation section."
        ]
    }],
    codeSchemas: [{
        name: "codeGenerators",
        required: false,
        type: "Promise<string>[]",
        description: [
            "Code generators allow you to create models at migration-time, to allow dynamic computation.",
            "To find out more about configuring code generators, read {@link https://prisma-util.gitbook.io/prisma-util/api-documentation/configuration-reference/code-generators this} documentation section."
        ]
    }],
    pgtrgm: [{
        name: "ftsIndexes",
        required: true,
        type: "{[fileModel: string]: {type: \"Gin\" | \"Gist\", indexes: { language: string, field: string, weight: string }[]}}",
        description: [
            "Create FTS Indexes for your models for a faster experience.",
            "To find out more about configuring full-text seach indexes, read {@link https://prisma-util.gitbook.io/prisma-util/api-documentation/configuration-reference/fts-indexes this} documentation section.",
            "@deprecated This feature has been deprecated because it has been implemented in the official Prisma Client."
        ]
    }, {
        name: "schema",
        required: true,
        type: "string",
        description: [
            "The schema of this database.",
            "To find out more about configuring full-text seach indexes, read {@link https://prisma-util.gitbook.io/prisma-util/api-documentation/configuration-reference/schema this} documentation section.",
            "@deprecated This feature has been deprecated because it has been implemented in the official Prisma Client."
        ]
    }],
    ignoreEmptyConditions: [],
    customAttributeFunctions: [{
        name: "defaultFunctions",
        required: false,
        type: `{[fileModelColumn: string]: (dmmf: import("@prisma/client/runtime/index").DMMF.Field) => any}`,
        description: [
            "Indicate which default function should be used for the column defined by the key of this key-value entry.",
            "To find out more about configuring default functions, read {@link https://prisma-util.gitbook.io/prisma-util/api-documentation/configuration-reference/default-functions this} documentation section."
        ]
    }],
    middlewareContext: []
};

/** Config type for prisma-util.config.mjs.*/
export type ConfigType = {
    /**Which .prisma files should be included. */
    includeFiles: (string | ((model?: string, name?: string) => string))[],
    /**Allows exclusion of specific models. */
    excludeModels?: string[],
    /**Base schema that provides the datasource and generator. */
    baseSchema: (string | ((model?: string, name?: string) => string)),
    /**Whether Prisma Util should try to resolve cross-file relation conflicts. */
    crossFileRelations?: boolean
    /**Optional features */
    optionalFeatures?: OptionalFeatures[]
    /** Allows extension of models (inheritance).
     * Example: 
     * 
     * "base.prisma:Topic": "schema.prisma:Post"
     * 
     * This example will add all of the non-ID non-relation columns from Post to Topic.
     */
    extended?: {
        [fileModel: string]: string
    }
    /** Relation map for resolving cross-file conflicts.
     * Example:
     * 
     * "base.prisma:User": "schema.prisma:BaseUser"
     * 
     * This example will change the type on the column from User to BaseUser. If there are name conflicts, the left one will always be replaced with the right one.
     */
    relations?: {
        [fileModel: string]: string
    }
    /**Whether code-generated schemas should be enabled or not. */
    codeSchemas?: boolean,
    /**Schema generators that use the @prisma-util/schema-creator package. */
    codeGenerators?: Promise<string>[],
    /**pg_trgm support */
    pgtrgm?: boolean,
    /**Full-text search support.*/
    ftsIndexes?: {
        [fileModel: string]: {
            type: "Gin" | "Gist",
            indexes: {
                language: string,
                field: string,
                weight: string
            }[]
        }
    },
    /** Postgres schema. */
    schema?: string;
    /** Middleware generation path. */
    middleware?: string;
    /** Remove OR statements if the array is empty. */
    ignoreEmptyConditions?: boolean;
    /** Default function mappings. */
    defaultFunctions?: {
        [fileModelColumn: string]: (dmmf: any) => any
    };
    /**Create custom attribute functions for @default. */
    customAttributeFunctions?: boolean;
    /**Disallow dev commands inside of production. */
    environmentLock?: boolean;
    /** Allow better environment handling. */
    virtualEnvironment?: boolean;
    /** Environment setup function. */
    environment?: () => Promise<void>
    /** Add support for Middleware Context API */
    middlewareContext?: boolean;
    /** Project toolchain configuration. */
    toolchain: {
        useExtensions: boolean,
        resolve: {
            types: string
        }
    };
    /** Deprecated fields feature. */
    deprecatedTag?: boolean;
    /** Messages for deprecated fields. */
    deprecated?: {
        [fileModelColumn: string]: string
    };
    /** Configure take for all queries.*/
    staticTake?: boolean;
    /** The staticTake configuration. */
    take?: {
        [model: string]: number
    } | {
        $global: number,
        [model: string]: number
    };
    /** Prisma Generators support. */
    prismaGenerators?: boolean;
    /** Configured Prisma Generators. */
    generators?: {
        include: (string | ((generator?: string) => string))[],
        run: {
            [key: string]: string | (() => Promise<boolean>) | boolean;
        }
    }
    /** Allow refining of types. */
    refinedTypes?: boolean;
    /** Refined type mappings. */
    fieldTypes?: {
        [fileModelColumn: string]: string
    },
    /** Allow enhanced introspection. */
    enhancedIntrospection?: boolean;
    /** Matcher block. */
    introspection?: {
        modelPatterns: {
            $static?: {
                [table: string]: string | ((model: IntrospectionModel) => Promise<IntrospectionModel>)
            }, 
            $regex?: {
                [tableRegex: string]: ((model: IntrospectionModel, match: string, ...groups: string[]) => Promise<IntrospectionModel>)
            }
        }
    }
};

/** Column type for schema models. */
export type Column = {
    name: string;
    type: string;
    constraints: string[];
}

/** Enum type for schemas. */
export type Enum = {
    name: string;
    values: string[];
}

/**Action type for resolving conflicts. */
export type Action = {
    type: "skip",
    item: "enum" | "model"
} | {
    type: "rename",
    newName: string,
    item: "enum" | "model"
} | {
    type: "rename-rel",
    newName: string,
    item: "enum" | "model"
} | {
    type: "remap",
    from: string,
    to: string,
    item: "enum" | "model"
};

/** Small parser utility to resolve conflicts. */
export default class PrismaParser {
    /**Get all the columns defined for the models loaded. */
    getModelColumns(): any {
        return this.modelColumns;
    }

    /** All of the models across all .prisma files. */
    models: {
        [file: string]: {
            [name: string]: string
        }
    };

    /** All of the files used by Prisma Util. */
    files: string[];

    /** Columns for models mapped by file-model association. */
    modelColumns: {
        [fileModel: string]: Column[]
    }
    /** The configuration file loaded by the util.*/
    config: ConfigType;

    /** Configuration file path for later use. */
    configPath: string;

    /**Generator part to be added. */
    generator?: string;

    /**Datasource part to be added. */
    datasource?: string;

    /**Map of generators that should be added and their environment requirements */
    generators: {
        [generatorName: string]: {
            code: string,
            run: boolean,
            meta: {
                file: string,
                name: string
            }
        }
    }

    /**New schema after conflicts are fixed. */
    solutions: {
        [key: string]: Action;
    }[];

    /**Remapper from config. */
    remapper: {
        [fileModel: string]: string
    };

    /**Enums */
    enums: {
        [fileModel: string]: Enum;
    }

    constructor(config: ConfigType, configPath: string) {
        this.config = config;

        if (this.config.optionalFeatures) {
            for (const feature of this.config.optionalFeatures)
                this.config[feature] = true;
        }

        if(this.config.virtualEnvironment && !this.config.environment)
            this.config.environment = async () => {};

        this.configPath = configPath;
        this.models = {};
        this.modelColumns = {};
        this.solutions = [];
        this.remapper = this.config.relations ? this.config.relations : {};
        this.enums = {};
        this.files = [];
        this.generators = {};
    }

    async loadEnvironment() {
        if(this.config.environmentLock)
        {
            if(this.config.virtualEnvironment && this.config.environment)
                await this.config.environment();
            else
                (await import("dotenv")).config();
        }
    }

    private getEnv(env: any)
    {
        if(typeof env == "boolean")
            return env;
        if(typeof env == "string")
            return env == "true";
        return !!env;
    }

    /** Load .prisma files from config and parse models.*/
    async load() {
        if (!this.config.baseSchema) {
            error("Base schema not found.");
            process.exit(1);
        }

        if(!this.config.toolchain)
        {
            error("Project Toolchain configuration not found.");
            process.exit(1);
        }

        if(!this.config.take)
        {
            this.config.take = {};
        }

        if(!this.config.generators)
        {
            this.config.generators = {include: [], run: {}};
        }

        if(!this.config.fieldTypes)
        {
            this.config.fieldTypes = {};
        }

        if(!this.config.introspection)
        {
            this.config.introspection = {
                modelPatterns: {}
            }
        }

        // Support for @prisma-util/schema-creator magic
        if (typeof this.config.baseSchema == "function")
            this.config.baseSchema = this.config.baseSchema();

        const includeFilesStrings = this.config.includeFiles.map(item => {
            if (typeof item == "function")
                return item();
            return item;
        });

        this.config.includeFiles = includeFilesStrings;

        this.files = [...includeFilesStrings, this.config.baseSchema];

        if (!this.config.excludeModels) {
            this.config.excludeModels = [];
        }

        if (!this.config.includeFiles || this.config.includeFiles.length == 0) {
            warn("You didn't specify any included files in your config!\n", "\n")
            this.config.includeFiles = [];
        }
        if (this.config.pgtrgm) {
            if (!this.config.schema) {
                error("You didn't set a schema in the configuration file.", "\n");
                process.exit(1);
            }
        }
        if (!this.config.extended)
            this.config.extended = {};

        if(this.config.toolchain.resolve.types)
            this.config.toolchain.resolve.types = await getConfigurationPath(this.config.toolchain.resolve.types);

        const includeFiles: {
            data: string,
            type: "FILE" | "SCHEMA",
            additionalName?: string
        }[] = [this.config.baseSchema, ...(this.config.includeFiles as string[])].map((val) => {
            return {
                type: "FILE",
                data: val
            };
        });

        if (this.config.codeSchemas && this.config.codeGenerators) {
            for (let i = 0; i < this.config.codeGenerators.length; i++) {
                const generator = this.config.codeGenerators[i];
                let spinner = createSpinner({
                    text: `${chalk.gray("Running code-schema generator ")}${chalk.blue(`#${i + 1}`)}${chalk.gray("...")}`,
                    prefixText: prismaCLITag
                }).start();

                includeFiles.push({
                    type: "SCHEMA",
                    data: await generator,
                    additionalName: `#${i + 1}`
                });

                spinner.stopAndPersist({
                    text: `${chalk.gray("Successfully generated schema from generator ")}${chalk.blue(`#${i + 1}`)}${chalk.gray(".")}`,
                    prefixText: '',
                    symbol: successTag
                });
            }
        }
        for (const file of includeFiles) {
            const fileData: {
                [name: string]: string
            } = {};
            if (typeof file.data == "function")
                file.data = await (file as any).data();
            const name = file.type == "SCHEMA" ? `codeSchemas${file.additionalName}` : file.data;
            let spinner = createSpinner({
                text: `${chalk.gray("Loading schema file from ")}${chalk.blue(name)}${chalk.gray("...")}`,
                prefixText: prismaCLITag
            }).start();
            const text = file.type == "FILE" ? await getSchema(file.data) : file.data;
            spinner.stopAndPersist({
                text: `${chalk.gray("Successfully loaded schema from ")}${chalk.blue(name)}${chalk.gray(".")}`,
                prefixText: '',
                symbol: successTag
            });

            // This is the base schema, parse it to get the generator and datasource.
            if (file.data == this.config.baseSchema) {
                spinner = createSpinner({
                    text: `${chalk.gray("Checking generator and datasource from ")}${chalk.blue(name)}${chalk.gray("...")}`,
                    prefixText: prismaCLITag
                }).start()

                const generatorRegex = /^([gG][eE][nN][eE][rR][aA][tT][oO][rR]\s*([^\s]+)(\s*\{((?=.*\n)[^}]+)\}))/gms;
                const dataSourceRegex = /^([dD][aA][tT][aA][sS][oO][uU][rR][cC][eE]\s*([^\s]+)(\s*\{((?=.*\n)[^}]+)\}))/gms;

                const generator = generatorRegex.exec(text);
                const datasource = dataSourceRegex.exec(text);

                if (!generator || !datasource) {
                    if (!generator)
                        error("The base schema doesn't contain a generator!");
                    if (!datasource)
                        error("The base schema doesn't contain a datasource!");
                    process.exit(1);
                }
                spinner.stopAndPersist({
                    text: `${chalk.gray("Successfully loaded generators and datasource from ")}${chalk.blue(name)}${chalk.gray(".")}`,
                    prefixText: '',
                    symbol: successTag
                });

                this.generator = generator[1];
                this.datasource = datasource[1];
            }

            spinner = createSpinner({
                text: `${chalk.gray("Adding models from ")}${chalk.blue(name)}${chalk.gray("...")}`,
                prefixText: prismaCLITag
            }).start();
            const regex = /^([mM][oO][dD][eE][lL]\s*([^\s]+)(\s*\{((?=.*\n)[^}]+)\}))/gms;
            const enumRegex = /^([eE][nN][uU][mM]\s*([^\s]+)(\s*\{((?=.*\n)[^}]+)\}))/gms;
            for (let enumsForFile; enumsForFile = enumRegex.exec(text);) {
                const enumName = enumsForFile[2];
                const enumBody = enumsForFile[4];

                if (!this.config.excludeModels.includes(`${name}:${enumName}`)) {
                    const enumElements = enumBody.split("\n").filter(line => line.trim()).map(line => line.trim());
                    this.enums[`${name}:${enumName}`] = {
                        name: enumName,
                        values: enumElements
                    };
                    fileData[enumName] = enumElements.join("\n");
                }
            }
            for (let modelsForFile; modelsForFile = regex.exec(text);) {
                const modelFull = modelsForFile[1];
                const modelName = modelsForFile[2];
                const modelBody = modelsForFile[4];

                // If the model isn't excluded, grab the columns and add it to the models
                if (!this.config.excludeModels.includes(`${name}:${modelName}`)) {
                    fileData[modelName] = modelFull
                    const columns = modelBody.split(/[\r\n]+/).filter(line => line.trim()).map(line => line.trim());
                    this.modelColumns[`${name}:${modelName}`] = columns.map(column => {
                        const [name, type, ...constraints] = column.split(" ");
                        return {
                            name, type, constraints
                        }
                    });
                }
            }

            // Add the new models to this specific file
            this.models[name] = fileData;
            spinner.stopAndPersist({
                text: `${chalk.gray("Successfully added models from ")}${chalk.blue(name)}${chalk.gray(".")}`,
                symbol: successTag
            });
        }

        if(this.config.prismaGenerators)
        {
            for(let generatorFile of this.config.generators.include)
            {
                if(typeof generatorFile == "function")
                    generatorFile = generatorFile();

                const generatorRegex = /generator\s*(\w+)\s*{(\s*\w+\s*=\s.*?\s*)}/gims;
                const content = await getSchema(generatorFile);

                for(let generatorsForFile; generatorsForFile = generatorRegex.exec(content);)
                {
                    const match = generatorsForFile[0];
                    let generatorName = generatorsForFile[1];
                    const initialGeneratorName = generatorsForFile[1];
                    const generatorBody = generatorsForFile[2];

                    let count = 1;
                    while(this.generators[generatorName])
                    {
                        generatorName = `${initialGeneratorName}${count}`;
                        count++;
                    }
                    if(count > 1)
                    {
                        conflict(`Generator ${chalk.bold(`${generatorFile}:${initialGeneratorName}`)} has been renamed to ${chalk.bold(generatorName)}.`);
                    }

                    const initialCondition = this.config.generators.run[`${generatorFile}:${initialGeneratorName}`];
                    let run = true;

                    if(initialCondition)
                    {
                        const condition = typeof initialCondition == "function" ? await initialCondition() : initialCondition;

                        if(condition)
                            run = typeof condition == "boolean" 
                                        ? condition
                                        : this.getEnv(process.env[condition]);
                    }
                                
                    this.generators[generatorName] = {
                        code: `generator ${generatorName} {${generatorBody}}`,
                        run: run,
                        meta: {
                            file: generatorFile,
                            name: initialGeneratorName
                        }
                    };
                }
            }
        }

        if (this.config.ftsIndexes) {
            for (const fileModel of Object.keys(this.config.ftsIndexes)) {
                this.modelColumns[fileModel].push({
                    name: "textSearch",
                    type: "Unsupported(\"TSVECTOR\")?",
                    constraints: ["@default(dbgenerated())"]
                }, {
                    name: `@@index([textSearch], type: ${this.config.ftsIndexes[fileModel].type})`,
                    type: "",
                    constraints: []
                });
            }
        }

        this.loaded = true;
        return this;
    }

    async resetMigrations()
    {
        const migrationPath = convertPathToLocal("./node_modules/.bin/migrations");
        try {
            await fs.unlink(migrationPath);
        } catch(_) {}
    }

    async prepareDocumentation()
    {
        const configPath = await getConfigurationPath(this.configPath);

        const schemaCreatorDTSPath = convertPathToLocal("node_modules/prisma-util/schema-creator/index.d.ts");
        const content = await fs.readFile(schemaCreatorDTSPath, "utf8");

        const models = Object.entries(this.modelColumns).filter((fileModelData) => {
            const [fileModel, columns] = fileModelData;
            return !this.getShadowedModels().includes(fileModel) && !this.getExtendedModels().includes(fileModel);
        });

        const goodModels: {
            [file: string]: {
                [model: string]: Column[]
            }
        } = {};

        for(const model of models)
        {
            let [fileModel, columns] = model;
            const [fileName, modelName] = fileModel.split(":");

            columns = columns.filter(c => c.name.trim() != "" && !c.name.trim().startsWith("/"));

            if(goodModels[fileName])
                goodModels[fileName][modelName] = columns;
            else
                goodModels[fileName] = {
                    [modelName]: columns
                };
        };

        const filesWithoutModels = this.files.filter(f => !models.some(n => n[0].split(":")[0] == f));
        
        const r = content.includes("// ProjectToolchain.exit(\"documentation\");") ? /export declare function constantModel\(path: string\): \(model\?: string, column\?: string\) => string;.*?\/\/ ProjectToolchain.exit\(\"documentation\"\);/gims : /export declare function constantModel\(path: string\): \(model\?: string, column\?: string\) => string;/gims;
        let final = content.replace(r, 
`export declare function constantModel(path: string): (model?: string, column?: string) => string;
${filesWithoutModels.map(file => {
    return `export declare function constantModel(path: "${file}"): (model?: string, column?: string) => string;`;
}).join("\n")}
${Object.entries(goodModels).map(entry => {
    const [file, assoc] = entry;
    const models = Object.entries(assoc);
    return `export declare function constantModel(path: "${file}"): <T extends ${models.map(mod => `"${mod[0]}"`).join(" | ")}>(model?: T, column?: ${models.map(mod => `T extends "${mod[0]}" ? ${mod[1].map(c => `"${c.name}"`).join(" | ")} : `).join("")} string) => string;`;
}).join("\n")}
// ProjectToolchain.exit("documentation");`);

        if(this.config.prismaGenerators && this.config.generators?.include)
        {
            const gr = final.includes("// ProjectToolchain.exit(\"documentation-generator\");") ? /export declare function constantGenerator\(path: string\): \(generator\?: string\) => string;.*?\/\/ ProjectToolchain.exit\(\"documentation-generator\"\);/gims : /export declare function constantGenerator\(path: string\): \(generator\?: string\) => string;/gims;
            
            const generators = Object.values(this.generators).map(gen => `${gen.meta.file}:${gen.meta.name}`);
            const filesWithoutGenerators = this.config.generators.include
                .map(f => typeof f == "function" ? f() : f)
                .filter(f => !generators.some(gen => gen.split(":")[0] == f));

            const goodGenerators: {
                [file: string]: string[]
            } = {};

            for(const generator of generators)
            {
                const [fileName, generatorName] = generator.split(":");
                if(goodGenerators[fileName])
                    goodGenerators[fileName].push(generatorName);
                else
                    goodGenerators[fileName] = [generatorName];
            }

            final = final.replace(gr, 
`export declare function constantGenerator(path: string): (generator?: string) => string;
${filesWithoutGenerators.map(file => {
    return `export declare function constantGenerator(path: "${file}"): (generator?: string) => string;`;
}).join("\n")}
${Object.entries(goodGenerators).map(entry => {
    const [file, generators] = entry;
    return `export declare function constantGenerator(path: "${file}"): <T extends ${generators.map(gen => `"${gen}"`).join(" | ")}>(generator?: T) => string;`;
}).join("\n")}
// ProjectToolchain.exit("documentation-generator");`);
        }

        const types = (await getFiles(this.config.toolchain.resolve.types)).filter(i => i.endsWith(".d.ts"));
        const getTypeRegex = (typeName: string) => new RegExp(`^\\s*(?:export)?\\s*(?:declare)?\\s*(?:export)?\\s*(?:type)\\s*(${typeName}.*?);`, "gims");

        const typeMap: {
            [key: string]: string[]
        } = {};
        const emptyTypeFiles: string[] = [];
        for(const type of types)
        {
            const name = path.relative(this.config.toolchain.resolve.types, type).replace(/\\/g, "/");
            const content = await fs.readFile(type, "utf8");

            const allTypesRegex = getTypeRegex("");
            for(let typesInFile; typesInFile = allTypesRegex.exec(content);)
            {
                const typeData = typesInFile[1];
                const typeName = (typeData.split("=", 1)[0] ? typeData.split("=", 1)[0] : "").trim();

                if(typeMap[name])
                    typeMap[name].push(typeName);
                else
                    typeMap[name] = [typeName];
            }

            if(!typeMap[name])
                emptyTypeFiles.push(name);
        }
        
        const tr = content.includes("// ProjectToolchain.exit(\"documentation-types\");") ? /export declare function importType\(path: string, typeName: string\): string;.*?\/\/ ProjectToolchain.exit\(\"documentation-types\"\);/gims : /export declare function importType\(path: string, typeName: string\): string;/gims;

        final = final.replace(tr, 
`export declare function importType(path: string, typeName: string): string;
${emptyTypeFiles.map(file => {
    return `export declare function importType(path: "${file}", typeName: string): string;`;
}).join("\n")}
${Object.entries(typeMap).map(entry => {
    const [file, types] = entry;
    return `export declare function importType<T extends ${types.map(gen => `"${gen}"`).join(" | ")}>(path: "${file}", typeName: T): string;`;
}).join("\n")}
// ProjectToolchain.exit("documentation-types");`);

        await fs.writeFile(schemaCreatorDTSPath, final);
        log("Prisma Util Toolchain has updated the Schema Creator definitions.", "\n");
        
        let textToWrite = (await fs.readFile(configPath, "utf8")).replace(/@typedef {".*} OptionalFeatures/gms, `@typedef {${OptionalFeaturesArray.map(feature => `"${feature}"`).join(" | ")}} OptionalFeatures`);
        const regex = /(?<=@typedef {Object} Configuration)(.*?\*\/)/gims;
        
        textToWrite = textToWrite.replace(regex, 
`
* 
* @property {FileModelConfig} baseSchema 
* The file that contains your generator and datasource. This path is relative to your project root.
* To find out more about configuring the base schema, read {@link https://prisma-util.gitbook.io/prisma-util/api-documentation#base-schema this} documentation section.
* 
* @property {FileModelConfig[]} includeFiles
* Files in this array will be merged in to the final schema by Prisma Util. 
* To find out more about configuring the included files, read {@link https://prisma-util.gitbook.io/prisma-util/api-documentation#include-files this} documentation section.
* 
* @property {string[]?} [excludeModels]
* This array uses the \`file:model\` association defined in the Prisma Util concepts. Models in this array will be excluded from the final build.
* To find out more about configuring the excluded models, read {@link https://prisma-util.gitbook.io/prisma-util/api-documentation#exclude-models this} documentation section.
* 
* @property {OptionalFeatures[]} optionalFeatures
* Allows you to enable optional features to supercharge your Prisma Util setup.
* To find out more about configuring optional features, read {@link https://prisma-util.gitbook.io/prisma-util/api-documentation#optional-features this} documentation section.
*
* @property {{[fileModel: string]: string}?} [extended]
* Create model inheritance within Prisma! The model defined by the value of this key-value entry will receive all non-id non-relation fields from the model defined by the key.
* To find out more about configuring model inheritance, read {@link https://prisma-util.gitbook.io/prisma-util/api-documentation#extend-models this} documentation section.
*
* @property {ProjectToolchainConfiguration} toolchain
* Project toolchain configuration block.
* To find out more about configuring Project Toolchain, read {@link https://prisma-util.gitbook.io/prisma-util/api-documentation#toolchain this} documentation section.
${Object.entries(configurationDocumentation).filter(entry => this.config.optionalFeatures?.includes(entry[0] as OptionalFeatures))
    .map(entry => {
        return entry[1].map(documentation => {
            return (
`* @property {${documentation.type}} ${documentation.required ? documentation.name : `[${documentation.name}]`}
${documentation.description.map(line => `* ${line}`).join("\n")}`);
        }).join("\n*\n");
    })
    .join("\n*\n")} 
*/`);
        await fs.writeFile(configPath, textToWrite);
    }

    public loaded: boolean = false;

    /** Get a list of raw models.*/
    getModels() {
        return this.models;
    }

    /** Prisma being prisma, creates DROP DEFAULT migrations. */
    async fixMigrate() {
        if (!this.config.pgtrgm)
            return false;

        const data = (await fs.readdir(convertPathToLocal("./node_modules/.bin/migrations"), {
            withFileTypes: true
        })).filter(entity => entity.isDirectory()).map(entity => entity.name);

        const markedMigrations: string[] = [];
        for (const file of data) {
            const content = await fs.readFile(path.join(convertPathToLocal("./node_modules/.bin/migrations"), file, "migration.sql"), "utf-8");
            if (!content.includes(`ALTER COLUMN "textSearch" DROP DEFAULT`))
                continue;
            markedMigrations.push(file);
        }

        if (markedMigrations.length == 0)
            return false;

        experimental("Trying to fix the error from above.", "\n");

        for (const migration of markedMigrations)
            await runPrismaCommand(`migrate resolve --applied "${migration}" --schema ./node_modules/.bin/generated-schema.prisma`);

        return true;
    }

    /**Hooks to run after client generation. */
    async generate() {

    }

    /**
     * Hooks to run during generation.
     */
    async toolchain()
    {
        let middlewareGenerator = MiddlewareToolchainInstance;
        let codeGenerator = GenerationToolchainInstance;
        let extensionsGenerator = ExtensionsToolchainInstance;

        // @deprecated - No extension
        if (this.config.pgtrgm && this.config.schema && this.config.ftsIndexes) {
            const modelMappings = Object.fromEntries(Object.entries(this.config.ftsIndexes).map(index => {
                return [index[0], index[1].indexes.map(ind => ind.field)];
            }));

            const code =
                `import { Prisma, PrismaClient } from "@prisma/client";

const ALLOWED_ACTIONS = ["findMany", "findFirst"];
const MAPPED_COLUMNS_MODELS = {
    ${Object.entries(modelMappings).map(entry => {
                    const split = entry[0].split(":");
                    return `"${split[split.length - 1]}": [${entry[1].map(en => `"${en}"`).join(", ")}]`;
                }).join(",\n    ")}
};
const MAPPED_MODELS = [${Object.keys(modelMappings).map(key => {
                    const split = key.split(":");
                    return `"${split[split.length - 1]}"`;
                }).join(", ")}];
const JOINT_FILTERS = ["equals", "has", "not", "in", "notIn", "lt", "lte", "gt", "gte"]
const INT_FILTERS = [...JOINT_FILTERS];
const STRING_FILTERS = [...JOINT_FILTERS, "contains", "endsWith", "startsWith", "mode"];
const SCALAR_FILTERS = ["equals", "hasEvery", "hasSome", "isEmpty"];
const BLOCK_FILTERS = ["NOT", "OR", "AND"];
const schema = "${this.config.schema}";

const MAPPED_SYMBOLS = {
    isEmpty: (first, second, mode) => Prisma.sql\`\${Prisma.raw(second ? \`\${first} = '{}'\` : \`\${first} <> '{}'\`)}\`,
    equals: (first, second, mode) => Prisma.sql\`\${Prisma.raw(first)} = \${second}\`,
    has: (first, secondy, mode) => Prisma.sql\`\${Prisma.raw(first)} @> \${[second]}\`,
    hasEvery: (first, second, mode) => Prisma.sql\`\${Prisma.raw(first)} @> \${second}\`,
    hasSome: (first, second, mode) => Prisma.sql\`\${Prisma.raw(first)} && \${second}\`,
    not: (first, second, mode) => Prisma.sql\`\${Prisma.raw(first)} <> \${second}\`,
    in: (first, second, mode) => Prisma.sql\`\${Prisma.raw(first)} IN (\${Prisma.join(second)})\`,
    notIn: (first, second, mode) => Prisma.sql\`\${Prisma.raw(first)} NOT IN (\${Prisma.join(second)})\`,
    lt: (first, second, mode) => Prisma.sql\`\${Prisma.raw(first)} < \${second}\`,
    lte: (first, second, mode) => Prisma.sql\`\${Prisma.raw(first)} <= \${second}\`,
    gt: (first, second, mode) => Prisma.sql\`\${Prisma.raw(first)} > \${second}\`,
    gte: (first, second, mode) => Prisma.sql\`\${Prisma.raw(first)} >= \${second}\`,
    contains: (first, second, mode) => mode == "default" ? Prisma.sql\`\${Prisma.raw(first)} LIKE \${second}\` : Prisma.sql\`\${Prisma.raw(first)} ILIKE \${\`%\${second}%\`}\`,
    endsWith: (first, second, mode) => mode == "default" ? Prisma.sql\`\${Prisma.raw(first)} LIKE \${second}}\` : Prisma.sql\`\${Prisma.raw(first)} ILIKE \${\`\${second}%\`}\`,
    startsWith: (first, second, mode) => mode == "default" ? Prisma.sql\`\${Prisma.raw(first)} LIKE \${second}\` : Prisma.sql\`\${Prisma.raw(first)} ILIKE \${\`%\${second}\`}\`
}

function check(object, MAPPED_COLUMNS)
{
    const [key, filter] = object;
    if(BLOCK_FILTERS.includes(key))
        return Object.entries(filter).some((val) => check(val, MAPPED_COLUMNS));
    return typeof filter == "string" && MAPPED_COLUMNS.includes(key);
}

function flatten(array) {
    return array.reduce(function (flatArray, arrayToFlatten) {
      return flatArray.concat(Array.isArray(arrayToFlatten) ? flatten(arrayToFlatten) : arrayToFlatten);
    }, []);
}

const middleware = (prisma) => async (params, next) => {

    if(!ALLOWED_ACTIONS.includes(params.action))
        return next(params);

    if(!params.model || !params.args.where || !MAPPED_MODELS.includes(params.model))
        return next(params);

    const MAPPED_COLUMNS = (MAPPED_COLUMNS_MODELS)[params.model];
    if(!Object.entries(params.args.where).some((val) => check(val, MAPPED_COLUMNS)))
        return next(params);

    const table = \`"\${schema}"."\${params.model}"\`;
    const limit = params.action == "findFirst" ? 1 : params.args.take ? params.args.take : 0;
    const offset = params.args.skip ? params.args.skip : 0;
    const selectedColumns = params.args.select ? ([...new Set(Object.keys(params.args.where).map(key => [key, true]).concat(Object.entries(params.args.select)).map(data => {
        return data[1] ? \`\${table}."\$\{data[0]}"\` : null;
    }).filter(String))]).map(val => Prisma.raw(val)) : ((prisma)["_baseDmmf"]["typeAndModelMap"][params.model]["fields"].filter((item) => !item.relationName).map((field) => [field.name, true]).map((data) => {
        return data[1] ? \`\${table}."\${data[0]}"\` : null;
    })).map((val) => Prisma.raw(val));
    const orderBy = params.args.orderBy ? Object.entries(params.args.orderBy)[0] : null;
    const matches = {};
    const cursor = params.args.cursor ? Object.entries(params.args.cursor).map(entry => [\`\${table}."\${entry[0]}"\`, entry[1]]).map((entry) => Prisma.sql\`\${Prisma.raw(entry[0])} > \${entry[1]}\`) : [];

    function doFilter(root, obj, first, action)
    {
        const object = Object.fromEntries(obj);
        let and = object["AND"];
        let or = object["OR"];
        let not = object["NOT"];

        const intFilters = 
            flatten(obj
                .filter(entry => Object.keys(entry[1]).some(key => INT_FILTERS.includes(key)))
                .map(entry => [\`\${table}."\${entry[0]}"\`, entry[1]]).map((entry) => {
                    const data = Object.entries(entry[1])
                        .filter(en => (typeof en[1] == "number" || (Array.isArray(en[1]) && typeof (en[1])[0] == "number") && en[0] != "equals"))
                        .map(en => {
                            return MAPPED_SYMBOLS[en[0]].apply(root, [entry[0], en[1]]);
                        });
                    return data;
                }));
        
        const baseIntFilters = 
            flatten(obj
                .map(entry => [\`\${table}."\${entry[0]}"\`, entry[1]])
                .filter(entry => typeof entry[1] != "object")
                .map((entry) => {
                    const data = Object.entries(entry[1])
                        .filter(en => (typeof en[1] == "number"))
                        .map(en => {
                            return MAPPED_SYMBOLS.equals.apply(root, [entry[0], en[1]]);
                        });
                    return data;
                }));
        const baseStringFilters = 
            flatten(obj
                .filter(entry => typeof entry[1] == "string")
                .map((entry) => {                    
                    if(MAPPED_COLUMNS.includes(entry[0]))
                    {
                        matches[entry[0]] = entry[1];
                        return [Prisma.sql\`(\${Prisma.raw(entry[0])} % \${entry[1]})\`];
                    }
                    entry[0] = \`\${table}."\${entry[0]}"\`;
                    return [MAPPED_SYMBOLS.equals.apply(root, [entry[0], entry[1]])];
                }));
        const stringFilters = 
            flatten(obj
                .filter(entry => Object.keys(entry[1]).some(key => STRING_FILTERS.includes(key)))
                .map(entry => [\`\${table}."\${entry[0]}"\`, entry[1]])
                .map((entry) => {
                    const data = Object.entries(entry[1])
                        .filter(en => en[0] != "mode" && typeof en[1] == "string" || (Array.isArray(en[1]) && typeof (en[1])[0] == "string" && en[0] != "equals"))
                        .map(en => {
                            return MAPPED_SYMBOLS[en[0]].apply(root, [entry[0], en[1], entry[1].mode ? entry[1].mode : "default"]);
                        });
                    return data;
                }));
        const scalarFilters = 
            flatten(obj
                .filter(entry => Object.keys(entry[1]).some(key => SCALAR_FILTERS.includes(key)))
                .map(entry => [\`\${table}."\${entry[0]}"\`, entry[1]])
                .map((entry) => {
                    const data = Object.entries(entry[1])
                        .filter(en => (Array.isArray(en[1]) || typeof en[1] == "boolean" && en[0] == "isEmpty"))
                        .map(en => {
                            return MAPPED_SYMBOLS[en[0]].apply(root, [entry[0], en[1]]);
                        });
                    return data;
                }));

        const conditions = 
        [
            ...(intFilters.length > 0 ? intFilters : []),
            ...(stringFilters.length > 0 ? stringFilters : []),
            ...(scalarFilters.length > 0 ? scalarFilters : []),
            ...(baseIntFilters.length > 0 ? baseIntFilters : []),
            ...(baseStringFilters.length > 0 ? baseStringFilters : []),
        ];

        let AND, OR, NOT;
        if(and)
            AND = doFilter(root, Object.entries(and), false, "AND");
        if(or)
            OR = doFilter(root, Object.entries(or), false, "OR");
        if(not)
            NOT = doFilter(root, Object.entries(not), false, "NOT");

        const data = 
        [
            ...(AND ? AND : []),
            ...(OR ? OR : []),
            ...(NOT ? NOT : []),
            ...conditions
        ]

        if(action && data.length > 0)
            return action == "NOT" ? [Prisma.sql\`(NOT (\${Prisma.join(data, \` AND \`)}))\`] : [Prisma.sql\`(\${Prisma.join(data, \` \${action} \`)})\`];
        
        return data.length > 0 ? [Prisma.join(data, " AND ")] : [];
    }
    const blockFilters = doFilter(this, Object.entries(params.args.where), true);

    const conditions = 
    [
        ...(cursor.length > 0 ? cursor : []),
        ...(blockFilters.length > 0 ? blockFilters : []),
    ];

    return prisma.$queryRaw\`SELECT \${Array.isArray(selectedColumns) ? Prisma.join(selectedColumns) : selectedColumns}\${orderBy ? Prisma.sql\`, SIMILARITY(\${Prisma.raw(orderBy[0])}, \${matches[orderBy[0]]}) as ftsScore\` : Prisma.empty} FROM \${Prisma.raw(table)} WHERE (\${Prisma.join(conditions, " AND ")})\${orderBy ? Prisma.sql\` ORDER BY ftsScore \${Prisma.raw(orderBy[1].toUpperCase())}\` : Prisma.empty}\${limit > 0 ? Prisma.sql\` LIMIT \${limit}\` : Prisma.empty}\${offset > 0 ? Prisma.sql\` OFFSET \${offset}\` : Prisma.empty}\`;
};

export default middleware;`;

            middlewareGenerator = MiddlewareToolchainInstance.defineMiddleware("pgtrgm", "ftsIndexes", code);
        }

        if(this.config.staticTake)
        {
            middlewareGenerator = middlewareGenerator.defineMiddleware("staticTake", "alterFindMany", 
`var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
import { getStaticTake } from "../../../../lib/functions.js";
var staticTake = Object.fromEntries(Object.entries(getStaticTake()).map(function (entry) { return entry[0] == "$global" ? entry : [entry[0].split(":")[1], entry[1]]; }));
var middleware = function (prisma) { return (function (params, next) { return __awaiter(void 0, void 0, void 0, function () {
    return __generator(this, function (_a) {
        if (params.action != "findMany" || !params.model || params.args.take)
            return [2 /*return*/, next(params)];
        if (staticTake[params.model])
            params.args.take = staticTake[params.model];
        else if (staticTake.$global)
            params.args.take = staticTake.$global;
        return [2 /*return*/, next(params)];
    });
}); }); };
export default middleware;
`)
            extensionsGenerator = extensionsGenerator.defineExtension("staticTake", "alterFindMany", 
`var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
import { getStaticTake } from "../../../../lib/functions.js";
var staticTake = Object.fromEntries(Object.entries(getStaticTake()).map(function (entry) { return entry[0] == "$global" ? entry : [entry[0].split(":")[1], entry[1]]; }));
export default function extension(prisma) {
    var _this = this;
    return prisma.$extends({
        query: {
            $allModels: {
                findMany: function (_a) {
                    var model = _a.model, operation = _a.operation, args = _a.args, query = _a.query;
                    return __awaiter(_this, void 0, void 0, function () {
                        return __generator(this, function (_b) {
                            if (args.take)
                                return [2 /*return*/, query(args)];
                            if (staticTake[model])
                                args.take = staticTake[model];
                            else if (staticTake.$global)
                                args.take = staticTake.$global;
                            return [2 /*return*/, query(args)];
                        });
                    });
                }
            }
        }
    });
}
`)
        }

        // Migration Done
        if(this.config.ignoreEmptyConditions)
        {
            const code = 
`var process = function (obj) {
    for (var prop in obj) {
        if (prop === 'OR' && obj[prop] && Array.isArray(obj[prop]) && obj[prop].length === 0)
            delete obj[prop];
        else if (typeof obj[prop] === 'object')
            obj[prop] = process(obj[prop]);
    }
    return obj;
};
var middleware = function (prisma) { return (function (params, next) {
    if (!params.model)
        return next(params);
    params.args = process(params.args);
    return next(params);
}); };
export default middleware;`;
            middlewareGenerator = middlewareGenerator.defineMiddleware("ignoreEmptyConditions", "removeEmptyOrBlock", code);
            extensionsGenerator = extensionsGenerator.defineExtension("ignoreEmptyConditions", "removeEmptyOrBlock", 
`var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var process = function (obj) {
    for (var prop in obj) {
        if (prop === 'OR' && obj[prop] && Array.isArray(obj[prop]) && obj[prop].length === 0)
            delete obj[prop];
        else if (typeof obj[prop] === 'object')
            obj[prop] = process(obj[prop]);
    }
    return obj;
};
export default function extension(prisma) {
    var _this = this;
    return prisma.$extends({
        query: {
            $allModels: {
                $allOperations: function (_a) {
                    var model = _a.model, operation = _a.operation, args = _a.args, query = _a.query;
                    return __awaiter(_this, void 0, void 0, function () {
                        return __generator(this, function (_b) {
                            args = process(args);
                            return [2 /*return*/, query(args)];
                        });
                    });
                }
            }
        }
    });
}
`);
        }

        // Migration Done
        if(true) {
            middlewareGenerator = middlewareGenerator.defineMiddleware("core", "defaultValue", 
`var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (_) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
import mappings from "../../../../lib/functions.js";
import { Prisma } from "@prisma/client";
var functionMap;
var process = function (prisma, params) {
    var ALLOWED_FUNCTIONS = ["update", "updateMany"];
    if (!ALLOWED_FUNCTIONS.includes(params.action) || !params.model || !params.args.where || !params.args.data)
        return params;
    var dmmfData = Prisma.dmmf.datamodel.models.find(model => model.name == params.model);
    var getFieldDMMF = function (field) {
        return dmmfData.fields.filter(function (f) { return f.name == field; })[0];
    };
    var isDefaultDBFunction = function (field) {
        return field.hasDefaultValue && field["default"] && typeof field["default"] == "object" && !Array.isArray(field["default"]) && field["default"].name && field["default"].args;
    };
    for (var _i = 0, _a = Object.entries(params.args.data); _i < _a.length; _i++) {
        var _b = _a[_i], key = _b[0], value = _b[1];
        var dmmf = getFieldDMMF(key);
        if (dmmf.relationName) {
            for (var _c = 0, _d = Object.entries(value); _c < _d.length; _c++) {
                var _e = _d[_c], func = _e[0], functionArgs = _e[1];
                var bottomParams = {
                    runInTransaction: params.runInTransaction,
                    model: dmmf.type,
                    action: func,
                    dataPath: params.dataPath,
                    args: functionArgs
                };
                params.args.data[key][func] = process(prisma, bottomParams).args;
            }
        }
        else {
            if (isDefaultDBFunction(dmmf) || value != prisma.$$default)
                continue;
            params.args.data[key] = functionMap["".concat(params.model, ".").concat(key)] ? functionMap["".concat(params.model, ".").concat(key)](dmmf) : dmmf["default"];
        }
    }
    return params;
};
var middleware = function (prisma) { return (function (params, next) { return __awaiter(void 0, void 0, void 0, function () {
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0: return [4 /*yield*/, mappings()];
            case 1:
                functionMap = (_a.sent()).columnMappings;
                return [2 /*return*/, next(process(prisma, params))];
        }
    });
}); }); };
export default middleware;
`);
            extensionsGenerator = extensionsGenerator.defineExtension("core", "defaultValue", 
`var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
import { Prisma } from '@prisma/client';
import mappings from "../../../../lib/functions.js";
var functionMap;
var process = function (prisma, params) {
    const ALLOWED_FUNCTIONS = ["update", "updateMany"];
    if(!ALLOWED_FUNCTIONS.includes(params.action) || !params.model || !params.args.where || !params.args.data)
        return params;
    var dmmfData = Prisma.dmmf.datamodel.models.find(function (model) { return model.name == params.model; });
    if (!dmmfData)
        return params;
    var getFieldDMMF = function (field) {
        return dmmfData.fields.filter(function (f) { return f.name == field; })[0];
    };
    var isDefaultDBFunction = function (field) {
        return field.hasDefaultValue && field["default"] && typeof field["default"] == "object" && !Array.isArray(field["default"]) && field["default"].name && field["default"].args;
    };
    for (var _i = 0, _a = Object.entries(params.args.data); _i < _a.length; _i++) {
        var _b = _a[_i], key = _b[0], value = _b[1];
        var dmmf = getFieldDMMF(key);
        if (dmmf.relationName) {
            for (var _c = 0, _d = Object.entries(value); _c < _d.length; _c++) {
                var _e = _d[_c], func = _e[0], functionArgs = _e[1];
                var bottomParams = {
                    model: dmmf.type,
                    action: func,
                    args: functionArgs
                };
                params.args.data[key][func] = process(prisma, bottomParams).args;
            }
        }
        else {
            if (isDefaultDBFunction(dmmf) || value != prisma.$$default)
                continue;
            params.args.data[key] = functionMap["".concat(params.model, ".").concat(key)] ? functionMap["".concat(params.model, ".").concat(key)](dmmf) : dmmf["default"];
        }
    }
    return params;
};
export default function extension(prisma) {
    var _this = this;
    return prisma.$extends({
        query: {
            $allModels: {
                update: function (params) { return __awaiter(_this, void 0, void 0, function () {
                    return __generator(this, function (_a) {
                        switch (_a.label) {
                            case 0:
                                if (!params.model || !params.args.where || !params.args.data)
                                    return [2 /*return*/, params.query(params.args)];
                                return [4 /*yield*/, mappings()];
                            case 1:
                                functionMap = (_a.sent()).columnMappings;
                                return [2 /*return*/, params.query(process(prisma, {
                                        args: params.args,
                                        model: params.model,
                                        action: params.operation
                                    }).args)];
                        }
                    });
                }); },
                updateMany: function (params) { return __awaiter(_this, void 0, void 0, function () {
                    return __generator(this, function (_a) {
                        switch (_a.label) {
                            case 0:
                                if (!params.model || !params.args.where || !params.args.data)
                                    return [2 /*return*/, params.query(params.args)];
                                return [4 /*yield*/, mappings()];
                            case 1:
                                functionMap = (_a.sent()).columnMappings;
                                return [2 /*return*/, params.query(process(prisma, {
                                        args: params.args,
                                        model: params.model,
                                        action: params.operation
                                    }).args)];
                        }
                    });
                }); }
            }
        }
    });
}
`);
}

        if(this.config.customAttributeFunctions)
        {
            middlewareGenerator = middlewareGenerator.defineMiddleware("customAttributeFunctions", "attributeFunctions", 
`var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (_) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
import mappings from "../../../../lib/functions.js";
import { Prisma } from "@prisma/client";
var modelMapping;
var process = function (prisma, params, relation) {
    if (relation === void 0) { relation = false; }
    var ALLOWED_FUNCTIONS = ["create", "createMany", "upsert", "connectOrCreate"];
    if (!ALLOWED_FUNCTIONS.includes(params.action) || !params.model)
        return params;
    var dmmfData = Prisma.dmmf.datamodel.models.find(model => model.name == params.model);
    var getFieldDMMF = function (field) {
        return dmmfData.fields.filter(function (f) { return f.name == field; })[0];
    };
    var rootKey = ["connectOrCreate", "upsert"].includes(params.action) ? "create" : "data";
    var root = params.args[rootKey];
    var emptyRoot = false;
    if (!root) {
        if (relation) {
            root = {};
            emptyRoot = true;
        }
        else
            return params;
    }
    for (var _i = 0, _a = Object.entries(root); _i < _a.length; _i++) {
        var _b = _a[_i], key = _b[0], value = _b[1];
        var dmmf = getFieldDMMF(key);
        if (dmmf.relationName) {
            for (var _c = 0, _d = Object.entries(value); _c < _d.length; _c++) {
                var _e = _d[_c], func = _e[0], functionArgs = _e[1];
                var bottomParams = {
                    runInTransaction: params.runInTransaction,
                    model: dmmf.type,
                    action: func,
                    dataPath: params.dataPath,
                    args: functionArgs
                };
                root[key][func] = process(prisma, bottomParams, true).args;
            }
        }
    }
    if (!modelMapping[params.model]) {
        if (emptyRoot)
            params.args = root;
        else
            params.args[rootKey] = root;
        return params;
    }
    for (var _f = 0, _g = Object.entries(modelMapping[params.model]).filter(function (entry) { return !Object.keys(root).includes(entry[0]); }); _f < _g.length; _f++) {
        var _h = _g[_f], key = _h[0], value = _h[1];
        root[key] = value(getFieldDMMF(key));
    }
    if (emptyRoot)
        params.args = root;
    else
        params.args[rootKey] = root;
    return params;
};
var middleware = function (prisma) { return (function (params, next) { return __awaiter(void 0, void 0, void 0, function () {
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0: return [4 /*yield*/, mappings()];
            case 1:
                modelMapping = (_a.sent()).modelMappings;
                return [2 /*return*/, next(process(prisma, params))];
        }
    });
}); }); };
export default middleware;
`)
            extensionsGenerator = extensionsGenerator.defineExtension("customAttributeFunctions", "attributeFunctions", 
`var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
import { Prisma } from '@prisma/client';
import mappings from "../../../../lib/functions.js";
var modelMapping;
var process = function (prisma, params, relation) {
    if (relation === void 0) { relation = false; }
    var ALLOWED_FUNCTIONS = ["create", "createMany", "upsert", "connectOrCreate"];
    if (!ALLOWED_FUNCTIONS.includes(params.action) || !params.model)
        return params;
    var dmmfData = Prisma.dmmf.datamodel.models.find(function (model) { return model.name == params.model; });
    if (!dmmfData)
        return params;
    var getFieldDMMF = function (field) {
        return dmmfData.fields.filter(function (f) { return f.name == field; })[0];
    };
    var rootKey = ["connectOrCreate", "upsert"].includes(params.action) ? "create" : "data";
    var root = params.args[rootKey];
    var emptyRoot = false;
    if (!root) {
        if (relation) {
            root = {};
            emptyRoot = true;
        }
        else
            return params;
    }
    for (var _i = 0, _a = Object.entries(root); _i < _a.length; _i++) {
        var _b = _a[_i], key = _b[0], value = _b[1];
        var dmmf = getFieldDMMF(key);
        if (dmmf.relationName) {
            for (var _c = 0, _d = Object.entries(value); _c < _d.length; _c++) {
                var _e = _d[_c], func = _e[0], functionArgs = _e[1];
                var bottomParams = {
                    model: dmmf.type,
                    action: func,
                    args: functionArgs
                };
                root[key][func] = process(prisma, bottomParams, true).args;
            }
        }
    }
    if (!modelMapping[params.model]) {
        if (emptyRoot)
            params.args = root;
        else
            params.args[rootKey] = root;
        return params;
    }
    for (var _f = 0, _g = Object.entries(modelMapping[params.model]).filter(function (entry) { return !Object.keys(root).includes(entry[0]); }); _f < _g.length; _f++) {
        var _h = _g[_f], key = _h[0], value = _h[1];
        root[key] = value(getFieldDMMF(key));
    }
    if (emptyRoot)
        params.args = root;
    else
        params.args[rootKey] = root;
    return params;
};
export default function extension(prisma) {
    var _this = this;
    return prisma.$extends({
        query: {
            $allModels: {
                create: function (params) { return __awaiter(_this, void 0, void 0, function () {
                    return __generator(this, function (_a) {
                        switch (_a.label) {
                            case 0: return [4 /*yield*/, mappings()];
                            case 1:
                                modelMapping = (_a.sent()).modelMappings;
                                return [2 /*return*/, params.query(process(prisma, {
                                        args: params.args,
                                        model: params.model,
                                        action: params.operation
                                    }).args)];
                        }
                    });
                }); },
                upsert: function (params) { return __awaiter(_this, void 0, void 0, function () {
                    return __generator(this, function (_a) {
                        switch (_a.label) {
                            case 0: return [4 /*yield*/, mappings()];
                            case 1:
                                modelMapping = (_a.sent()).modelMappings;
                                return [2 /*return*/, params.query(process(prisma, {
                                        args: params.args,
                                        model: params.model,
                                        action: params.operation
                                    }).args)];
                        }
                    });
                }); },
                createMany: function (params) { return __awaiter(_this, void 0, void 0, function () {
                    return __generator(this, function (_a) {
                        switch (_a.label) {
                            case 0: return [4 /*yield*/, mappings()];
                            case 1:
                                modelMapping = (_a.sent()).modelMappings;
                                return [2 /*return*/, params.query(process(prisma, {
                                        args: params.args,
                                        model: params.model,
                                        action: params.operation
                                    }).args)];
                        }
                    });
                }); }
            }
        }
    });
}
`)
        }

        // Migration Done
        if(this.config.middlewareContext)
        {
            middlewareGenerator = middlewareGenerator.defineMiddleware("middlewareContext", "contextRemover", 
`var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var middleware = function (prisma) { return (function (params, next) { return __awaiter(void 0, void 0, void 0, function () {
    return __generator(this, function (_a) {
        if (!params.args.context)
            return [2 /*return*/, next(params)];
        delete params.args.context;
        return [2 /*return*/, next(params)];
    });
}); }); };
export default middleware;
`);
            extensionsGenerator = extensionsGenerator.defineExtension("middlewareContext", "contextRemover", 
`var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
export default function extension(prisma) {
    var _this = this;
    return prisma.$extends({
        query: {
            $allModels: {
                $allOperations: function (_a) {
                    var model = _a.model, operation = _a.operation, args = _a.args, query = _a.query;
                    return __awaiter(_this, void 0, void 0, function () {
                        return __generator(this, function (_b) {
                            if (args.context)
                                delete args.context;
                            return [2 /*return*/, query(args)];
                        });
                    });
                }
            }
        }
    });
}
`);
        }

        await this.generateInternal();
        await middlewareGenerator.generate();
        await extensionsGenerator.generate();
        await this.prepareDocumentation();

        await fs.writeFile(convertPathToLocal(path.join("node_modules", "prisma-util", "lib", "generated.js")), `export default ${json5.stringify(this.config)};`);
    }

    /**
     * Internal generation function.
     */
    private async generateInternal()
    {
        const models = Object.entries(this.modelColumns).filter((fileModelData) => {
            const [fileModel, columns] = fileModelData;
            return !this.getShadowedModels().includes(fileModel) && !this.getExtendedModels().includes(fileModel);
        }).map(entry => entry[0].split(":")[1]);
        const modelColumns = Object.entries(this.modelColumns).filter((fileModelData) => {
            const [fileModel, columns] = fileModelData;
            return !this.getShadowedModels().includes(fileModel) && !this.getExtendedModels().includes(fileModel);
        });

        let transaction = GenerationToolchainInstance.useExtensions(this.config.toolchain.useExtensions)
            .createEditTransaction()
            .requestAsset(GenerationToolchainInstance.ASSETS.PRISMA_CLIENT_GENERATED.INDEX_TYPES)
            .createBlock()
            .setIgnoreExtensions(true)
            .setStrategy(EditStrategy.REGEX)
            .findLine("$use", 1)
            .appendContent(
                `  
  /**
   * Remove a middleware
   */
  $unuse(cb: Prisma.Middleware): void
  `)
            .createBlock()
            .setIgnoreExtensions(true)
            .setStrategy(EditStrategy.REGEX)
            .findLine("$use", 1)
            .appendContent(
                `/**
     * Reset a column to its default value.
     */
    public readonly $$default = "$$default";`)
            .createBlock()
            .setIgnoreExtensions(true)
            .setStrategy(EditStrategy.REGEX)
            .findLine("export type ModelName = (typeof ModelName)[keyof typeof ModelName]", 1)
            .appendContent(
                `
  export const EnumName: {
    ${Object.values(this.enums).map(e => `${e.name}: "${e.name}"`).join(",\n    ")}
  };
  export type EnumName = (typeof EnumName)[keyof typeof EnumName];
`);

        const regexMappings = <const> {
            BigInt: "BigIntFieldUpdateOperationsInput \\| bigint \\| number",
            Boolean: "BoolFieldUpdateOperationsInput \\| boolean",
            DateTime: "DateTimeFieldUpdateOperationsInput \\| Date \\| string",
            Decimal: "DecimalFieldUpdateOperationsInput \\| Decimal \\| DecimalJsLike \\| number \\| string",
            Float: "FloatFieldUpdateOperationsInput \\| number",
            Int: "IntFieldUpdateOperationsInput \\| number",
            String: "StringFieldUpdateOperationsInput \\| string",
        };

        const normalMappings: any = {
            BigInt: "BigIntFieldUpdateOperationsInput | bigint | number",
            Boolean: "BoolFieldUpdateOperationsInput | boolean",
            DateTime: "DateTimeFieldUpdateOperationsInput | Date | string",
            Decimal: "DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string",
            Float: "FloatFieldUpdateOperationsInput | number",
            Int: "IntFieldUpdateOperationsInput | number",
            String: "StringFieldUpdateOperationsInput | string",
        };

        /**
        * 1 = Name without ModelName
        * 
        * 2 = Body
        */
        
        const masterRegex = (modelName: string) => new RegExp(`^\\s*export type ${modelName}[^\\n]*?Input = {(.+?)}`, "gims");
        const columnRegex = (columnName: string, columnType: keyof typeof regexMappings) => new RegExp(`(\\s+?)${columnName}\\?: ${regexMappings[columnType]}(\\s\\|\\s"\\$\\$default")*`, "gims");
        const columnRefinedRegex = (columnName: string) => new RegExp(`^(\\s+?)${columnName}(\\??):.*?$`, "gims");

        const usedTypes: {
            [typeName: string]: string
        } = {};

        const getTypeRegex = (typeName: string) => new RegExp(`^\\s*(?:export)?\\s*(?:declare)?\\s*(?:export)?\\s*(?:type)\\s*(${typeName}.*?);`, "gims");
        for(const [fileModelName, columns] of modelColumns)
        {        
            const [fileName, modelName] = fileModelName.split(":");
            for(const column of columns.filter(column => !column.name.startsWith("//")))
            {
                if(this.config.refinedTypes && this.config.fieldTypes && this.config.fieldTypes[`${fileModelName}.${column.name}`])
                {
                    let [typeFile, typeName] = this.config.fieldTypes[`${fileModelName}.${column.name}`].split(":");
                    const initialTypeName = typeName;
                    const content = await fs.readFile(path.join(this.config.toolchain.resolve.types, typeFile), "utf8");
                    const result = getTypeRegex(typeName).exec(content);
                    if(!result)
                    {
                        continue;
                    }

                    const typeData = result[1];
                    const [_, ...rest] = typeData.split("=");
                    const typeDef = rest.join("=").trim();

                    let tries = 1;
                    while(usedTypes[typeName])
                    {
                        typeName = `${initialTypeName}${tries}`;
                        tries++;
                    }

                    const columnName = column.name;
                    const columnType: any = column.type;
                    transaction = transaction.createBlock()
                                .setIgnoreExtensions(true)
                                .setStrategy(EditStrategy.REPLACE_UNSAFE)
                                //(?<=export type User)([^\n]*?)(?=Input = {(.*?)})
                                .findLine(masterRegex(modelName))
                                .appendContent((match, g1, g2) => {
                                    return match.replace(columnRefinedRegex(columnName), `$1${columnName}$2: PrismaUtil_${typeName}${(column.constraints.some(c => c.includes("@default")) || (this.config.defaultFunctions && !!this.config.defaultFunctions[`${fileModelName}.${column.name}`])) ? ` | \"$$$$default\"` : ""}`);
                                })
                                .setSearch(IGNORE_SEARCH_STEP);

                    usedTypes[typeName] = `type PrismaUtil_${typeName} =${typeDef}`;
                } else
                {
                    if((column.constraints.some(c => c.includes("@default")) || (this.config.defaultFunctions && !!this.config.defaultFunctions[`${fileModelName}.${column.name}`])))
                    {
                        const columnName = column.name;
                        const columnType: any = column.type;
                        transaction = transaction.createBlock()
                                    .setIgnoreExtensions(true)
                                    .setStrategy(EditStrategy.REPLACE_UNSAFE)
                                    //(?<=export type User)([^\n]*?)(?=Input = {(.*?)})
                                    .findLine(masterRegex(modelName))
                                    .appendContent((match, g1, g2) => {
                                        return match.replace(columnRegex(columnName, columnType), `$1${columnName}?: ${normalMappings[columnType]}${match.trim().endsWith("\"$$default\"") ? "" : " | \"$$$$default\""}`);
                                    })
                                    .setSearch(IGNORE_SEARCH_STEP);
                    }
                }
            }
        }

        if(this.config.deprecatedTag && this.config.deprecated)
        {
            const deprecatedRegex = (column: string) => new RegExp(`(?:\\/\\*\\*.*?\\*\\/)*(\\s+)(${column}\\?*: [^\\n]*)`, "gims");
            const deprecatedMasterRegex = (model: string) => new RegExp(`^\\s*export type ${model} = {(.+?)}`, "gims");
            for(const [fileModelName, columns] of modelColumns)
            {
                const [fileName, modelName] = fileModelName.split(":");
                for(const column of columns)
                {
                    if(!this.config.deprecated[`${fileModelName}.${column.name}`])
                        continue;
                    
                    transaction = transaction.createBlock()
                        .setIgnoreExtensions(true)
                        .setStrategy(EditStrategy.REPLACE_UNSAFE)
                        //(?<=export type User)([^\n]*?)(?=Input = {(.*?)})
                        .findLine(masterRegex(modelName))
                        .appendContent((match, g1, g2) => {
                            return match.replace(deprecatedRegex(column.name), `$1/** @deprecated ${(this.config.deprecated ? this.config.deprecated : {})[`${fileModelName}.${column.name}`]} */\n     $2`);
                        })
                        .setSearch(IGNORE_SEARCH_STEP)
                        .createBlock()
                        .setIgnoreExtensions(true)
                        .setStrategy(EditStrategy.REPLACE_UNSAFE)
                        //(?<=export type User)([^\n]*?)(?=Input = {(.*?)})
                        .findLine(deprecatedMasterRegex(modelName))
                        .appendContent((match, g1, g2) => {
                            return match.replace(deprecatedRegex(column.name), `$1/** @deprecated ${(this.config.deprecated ? this.config.deprecated : {})[`${fileModelName}.${column.name}`]} */\n  $2`);
                        })
                        .setSearch(IGNORE_SEARCH_STEP);
                }
            }
        }

        const masterRegexReadonly = (modelName: string) => new RegExp(`^\\s*export type ${modelName}[^\\n]*(?:Upsert|Create|Update)[^\\n]*?Input = {(.+?)}`, "gims");

        if(this.config.middlewareContext)
        {
            const modelRegex = (modelName: string) => new RegExp(`export type (${modelName}[^\\n]*?Args(?:Base)*)(<.*?>)* = {(.*?\\s)}`, "gims");
            for(const model of models)
            {
                transaction = transaction.createBlock()
                    .setIgnoreExtensions(true)
                    .setStrategy(EditStrategy.REPLACE_UNSAFE)
                    //(?<=export type User)([^\n]*?)(?=Input = {(.*?)})
                    .findLine(modelRegex(model))
                    .appendContent((match, g1, g2, g3) => {
                        return `export type ${g1}${g2} = {${g3}${match.includes("context?") ? "" : "  context?: {[key: string]: any}\n "}}`;
                    })
                    .setSearch(IGNORE_SEARCH_STEP);
            }
        }

        if(Object.entries(usedTypes).length > 0)
        {
            transaction = transaction.createBlock()
                .setIgnoreExtensions(true)
                .setStrategy(EditStrategy.REPLACE_FULL)
                .findLine(/(.+)/gims)
                .appendContent((match, g1) => {
                    return match.includes("// Exit Types") ? match.replace(/(.*?)\/\/ Exit Types/s, (match) => `${Object.values(usedTypes).join("\n")}\n// Exit Types`) : `${Object.values(usedTypes).join("\n")}\n// Exit Types\n`;
                })
                .setSearch(IGNORE_SEARCH_STEP);
        }

        await transaction
            .end()
            .createEditTransaction()
            .requestAsset(GenerationToolchainInstance.ASSETS.PRISMA_CLIENT_RUNTIME.INDEX)
            .createBlock()
            .setIgnoreExtensions(true)
            .setStrategy(EditStrategy.REGEX)
            .findLine("$use(arg0, arg1)")
            .appendContent(
                `
    $unuse(arg0) {
        if (typeof arg0 === "function") {
          this._middlewares.query.unuse(arg0);
        } else {
          throw new Error(\`Invalid middleware \${arg0}\`);
        }
    }
`)
            .createBlock()
            .setIgnoreExtensions(true)
            .setStrategy(EditStrategy.REGEX)
            .findLine("this._middlewares = new Middlewares();")
            .appendContent(
                `
        this.$$default = "$$default";
`)
            .createBlock()
            .setIgnoreExtensions(true)
            .setStrategy(EditStrategy.REGEX)
            .findLine("use(middleware)")
            .appendContent(
                `
  unuse(middleware) {
    this._middlewares = this._middlewares.filter(item => item !== middleware);
  }
`)
            .end()
            .createEditTransaction()
            .requestAsset(GenerationToolchainInstance.ASSETS.PRISMA_CLIENT_GENERATED.INDEX)
            .createBlock()
            .setIgnoreExtensions(true)
            .setStrategy(EditStrategy.REGEX)
            .findLine("exports.Prisma.ModelName")
            .appendContent(
                `
exports.Prisma.EnumName = makeEnum({
  ${Object.values(this.enums).map(e => `${e.name}: "${e.name}"`).join(",\n  ")}
});
`)
            .end()
            .process();
    }

    /** Change migration to accomodate full-text search indexes. */
    async migrate(command: string) {
        if (this.config.pgtrgm) {
            try {
                await fs.mkdir(convertPathToLocal("./node_modules/.bin/migrations"));
            } catch (err) { }

            const current = (await fs.readdir(convertPathToLocal("./node_modules/.bin/migrations"), {
                withFileTypes: true
            })).filter(entity => entity.isDirectory()).map(entity => entity.name);
            await runPrismaCommand(`${command} --create-only`);
            const after = (await fs.readdir(convertPathToLocal("./node_modules/.bin/migrations"), {
                withFileTypes: true
            })).filter(entity => entity.isDirectory()).map(entity => entity.name);

            const difference = current
                .filter(x => !after.includes(x))
                .concat(after.filter(x => !current.includes(x)));

            const detected = difference.length > 0 ? difference[0] : null;
            if (detected) {
                experimental(`Migration created successfully, detected: ${chalk.bold(detected)}.`, "\n");
            }
            else {
                error("Prisma migration couldn't be detected automatically.", "\n")
                process.exit(1);
            }

            const migrationPath = path.join(convertPathToLocal("./node_modules/.bin/migrations"), detected, "migration.sql");
            let migration = await fs.readFile(migrationPath, "utf8");

            /**
             * Table Name: 1,
             * 
             * Table Body: 2
             */
            const createTableRegex = /CREATE TABLE "(\S*)" \((.*?)\);/gms;
            /**
             * Table Name: 1,
             * 
             * Column action: 2
             */
            const alterTableRegex = /ALTER TABLE "(\S*)" (.*?) COLUMN "textSearch" TSVECTOR;/gms;

            const migrationTables: {
                [table: string]: string
            } = {};
            const original: {
                [table: string]: string
            } = {};

            const alteredTables: {
                [table: string]: string
            } = {};

            for (let tables; tables = createTableRegex.exec(migration);) {
                const tableName = tables[1];
                const tableBody = tables[2];

                if (!tableBody.includes(`"textSearch" TSVECTOR`))
                    continue;

                const toReplace = `CREATE TABLE "${tableName}" (${tableBody});`;
                migrationTables[tableName] = toReplace;
                original[tableName] = toReplace;
            }

            for (let altered; altered = alterTableRegex.exec(migration);) {
                const tableName = altered[1];
                const action = altered[2];
                alteredTables[tableName] = action;
            }

            if (this.config.ftsIndexes) {
                for (const [fileModel, ftsIndex] of Object.entries(this.config.ftsIndexes)) {
                    const [file, model] = fileModel.split(":");
                    migration = migration.replace(`"${model}"("textSearch")`, `"${model}" USING ${ftsIndex.type} ("textSearch")`);

                    const current = migrationTables[model];

                    if (current) {
                        const toReplace = `TSVECTOR GENERATED ALWAYS AS (${ftsIndex.indexes.map(index => {
                            return `setweight(to_tsvector('${index.language}', coalesce("${index.field}", '')), '${index.weight}')`
                        }).join(" || ")}) STORED`;
                        migrationTables[model] = current.replace(/TSVECTOR/gms, toReplace);
                    }

                    const currentAltered = alteredTables[model];
                    if (currentAltered) {
                        const toReplace = `ALTER TABLE "${model}" ${currentAltered} COLUMN "textSearch" TSVECTOR GENERATED ALWAYS AS (${ftsIndex.indexes.map(index => {
                            return `setweight(to_tsvector('${index.language}', coalesce("${index.field}", '')), '${index.weight}')`
                        }).join(" || ")}) STORED`;
                        migration = migration.replace(`ALTER TABLE "${model}" ${currentAltered} COLUMN "textSearch" TSVECTOR`, toReplace);
                    }
                }
            }

            for (const [table, body] of Object.entries(migrationTables)) {
                migration = migration.replace(original[table], body);
            }

            const migrationText =
                `-- [EXPERIMENTAL] Prisma Util has generated the lines below to accomodate full-text search indexes.\n
CREATE EXTENSION IF NOT EXISTS pg_trgm;\n
-- [EXPERIMENTAL] The lines below are NOT generated by Prisma Util.\n
${migration}`;
            await fs.writeFile(migrationPath, migrationText);

            experimental(`Migration ${chalk.bold(detected)} updated to accomodate full-text search indexes.`, "\n");
        }
        return this.config.pgtrgm;
    }

    /** Returns all name conflicts.*/
    async getConflicts() {
        const files = await this.applyPatches();

        // Will be replaced by the mapper
        const shadowedByMapper = this.getShadowedModels();
        // Won't be added to final schema
        const extendedModels = this.getExtendedModels();

        // Obtain frequency map
        const frequencyMap: {
            [key: string]: number
        } = {};

        for (const file of files) {
            const fileName = file[0];
            const fileData = file[1];

            Object.keys(fileData).forEach((modelName) => {
                if (!extendedModels.includes(`${fileName}:${modelName}`)) {
                    if (this.config.crossFileRelations) {
                        // Removed by mapper
                        if (!shadowedByMapper.includes(`${fileName}:${modelName}`)) {
                            if (!frequencyMap[modelName])
                                frequencyMap[modelName] = 1;
                            else
                                frequencyMap[modelName] = frequencyMap[modelName] + 1;
                        }
                    } else {
                        if (!frequencyMap[modelName])
                            frequencyMap[modelName] = 1;
                        else
                            frequencyMap[modelName] = frequencyMap[modelName] + 1;
                    }
                }
            });
        }

        // Generate list of conflicts
        const conflicts: {
            1: {
                name: string;
                type: "model" | "enum"
            };
            2: {
                name: string;
                type: "model" | "enum"
            };
        }[] = [];

        const mapped = files.map(file => Object.keys(file[1]).map(value => `${file[0]}:${value}`));
        const flattened = flatten(mapped).filter(flat => !shadowedByMapper.includes(flat) && !extendedModels.includes(flat));

        // modelName: fileModelAssociation
        const matching: {
            [modelName: string]: string[];
        } = {};
        // Get all model names that appear more than once
        const duplicated = Object.entries(frequencyMap).filter(item => item[1] > 1).map(item => `:${item[0]}`);
        // Obtained duplicated models with file name
        const doubledModels = flattened.filter(flattenedItem => endsWithAny(flattenedItem, duplicated));

        // Obtained the matching models
        doubledModels.forEach((modelFileName) => {
            const parts = modelFileName.split(":");
            const modelName = parts[1];

            const array = matching[modelName] ? matching[modelName] : [];
            array.push(modelFileName);
            matching[modelName] = array;
        });

        // Add to conflicts and done!
        Object.entries(matching).forEach((association) => {
            const filesWithModel = association[1];
            /* assign conflicts accordingly: 
            Example:
            filesWithModel: ["file1", "file2", "file3", "file4"]
            0 -> 1, 0 -> 2, 0 -> 3 
            1 -> 2, 1 -> 3
            2 -> 3
            */
            for (let i = 0; i < filesWithModel.length; i++) {
                for (let j = i + 1; j < filesWithModel.length; j++) {
                    conflicts.push({
                        "1": {
                            name: filesWithModel[i],
                            type: this.enums[filesWithModel[i]] ? "enum" : "model"
                        },
                        "2": {
                            name: filesWithModel[j],
                            type: this.enums[filesWithModel[j]] ? "enum" : "model"
                        },
                    })
                }
            }
        });

        // Finally, return the conflicts
        return conflicts;
    }
    /** Get models that will be removed by the mapper. */
    getShadowedModels() {
        return Object.entries(this.remapper).map((remapped) => {
            const [toMapFileName, toMapModelName] = remapped[1].split(":");
            const [fileName, modelColumn] = remapped[0].split(":");
            return `${fileName}:${toMapModelName}`;
        });
    }

    /** Get models that will only server as a polyfill. */
    getExtendedModels() {
        if (!this.config.extended)
            this.config.extended = {};
        return Object.entries(this.config.extended).map((extended) => {
            const [toMapFileName, toMapModelName] = extended[1].split(":");
            return `${toMapFileName}:${toMapModelName}`;
        });
    }

    /** Get the model names that will be enriched by the mapper. */
    getReplacementModels() {
        return Object.entries(this.remapper).map((remapped) => remapped[1]);
    }

    private appliedIntrospection = false;

    /** Apply solutions to conflicts. */
    async applyPatches(): Promise<[string, { [name: string]: string; }][]> {
        for (const solution of this.solutions) {
            const actions = Object.entries(solution);
            for (const action of actions) {
                const [fileName, modelName] = action[0].split(":");
                const actionData = action[1];

                const value = this.models[fileName];
                const { [modelName]: _, ...object } = value;
                const { [action[0]]: _columns, ...rest } = this.modelColumns;
                if (action[1].type != "remap") {
                    this.models[fileName] = object;
                    this.modelColumns = rest;
                }

                let _enum;

                if (actionData.item == "enum") {
                    const { [`${fileName}:${modelName}`]: _, ...object } = this.enums;
                    this.enums = object;
                    _enum = _;
                }

                if (actionData.type == "rename" || actionData.type == "rename-rel") {
                    if (actionData.item == "enum") {
                        if (_enum) {
                            this.enums[`${fileName}:${actionData.newName}`] = _enum;
                            this.models[fileName][actionData.newName] = _enum.values.join("\n");
                        }
                    } else {
                        this.models[fileName][actionData.newName] = _;
                        this.modelColumns[`${fileName}:${actionData.newName}`] = _columns;

                        if(actionData.type == "rename-rel")
                        {
                            const relations = this.getReferredRelations(`${fileName}:${modelName}`)
                            for(const rel of relations)
                            {
                                const column = this.modelColumns[rel.model].find(c => c.name == rel.column.name);
                                if(!column)
                                    continue;
                                column.type = actionData.newName;
                                this.modelColumns[rel.model] = this.modelColumns[rel.model]
                                        .filter(c => c.name != rel.column.name)
                                        .concat([column]);
                            }
                        }

                        this.remap(`${fileName}:${modelName}`, `${fileName}:${actionData.newName}`);
                    }
                }

                if (actionData.type == "remap") {
                    this.remapper[actionData.from] = actionData.to;
                }
            }
        }
        if(this.config.enhancedIntrospection && this.config.introspection)
        {
            this.appliedIntrospection = false;
            const modelPatterns = this.config.introspection.modelPatterns;
            for(const entry of Object.entries(modelPatterns))
            {
                const [mapperType, _] = entry;
                switch(mapperType)
                {
                    case "$static":
                        modelPatterns.$static = modelPatterns.$static ? modelPatterns.$static : {};
                        for(const [tableName, action] of Object.entries(modelPatterns.$static).filter(en => Object.keys(this.modelColumns).some(k => k.split(":")[1] == en[0])))
                        {
                            this.appliedIntrospection = true;

                            const addAttribute = (attribute: string) => {
                                for(const possibleFile of Object.keys(this.modelColumns).filter(k => k.split(":")[1] == tableName))
                                {
                                    if(!this.modelColumns[possibleFile].some(c => c.name == `${attribute}`))
                                        this.modelColumns[possibleFile].push({
                                            name: `${attribute}`,
                                            type: "",
                                            constraints: []
                                        });
                                }
                            }
    
                            let introspectionModel: IntrospectionModel = {
                                name: tableName,
                                addAttribute
                            }
                            
                            if(typeof action == "string")
                                introspectionModel.name = action;
                            else
                                introspectionModel = await action(introspectionModel);

                            introspectionModel.addAttribute(Constraints.Model.MAP(tableName));

                            for(const possibleFile of Object.keys(this.modelColumns).filter(k => k.split(":")[1] == tableName))
                            {
                                this.suggest(`${possibleFile}`, {
                                    type: "rename-rel",
                                    item: "model",
                                    newName: introspectionModel.name
                                });
                            }
                        }
                        break;
                    case "$regex":
                        modelPatterns.$regex = modelPatterns.$regex ? modelPatterns.$regex : {};
                        for(const [r, action] of Object.entries(modelPatterns.$regex).filter(en => Object.keys(this.modelColumns).some(k => new RegExp(en[0], "gims").test(k.split(":")[1]))))
                        {
                            const reg = new RegExp(r, "gims");
                            for(const tableName of Object.keys(this.modelColumns).map(k => k.split(":")[1]))
                            {
                                for(let matches; matches = reg.exec(tableName);)
                                {
                                    this.appliedIntrospection = true;

                                    const addAttribute = (attribute: string) => {
                                        for(const possibleFile of Object.keys(this.modelColumns).filter(k => k.split(":")[1] == tableName))
                                        {
                                            if(!this.modelColumns[possibleFile].some(c => c.name == `${attribute}`))
                                                this.modelColumns[possibleFile].push({
                                                    name: `${attribute}`,
                                                    type: "",
                                                    constraints: []
                                                });
                                        }
                                    }
            
                                    let introspectionModel: IntrospectionModel = {
                                        name: tableName,
                                        addAttribute
                                    }
                                            
                                    introspectionModel = await action(introspectionModel, matches[0], ...matches.slice(1));
        
                                    introspectionModel.addAttribute(Constraints.Model.MAP(tableName));
        
                                    for(const possibleFile of Object.keys(this.modelColumns).filter(k => k.split(":")[1] == tableName))
                                    {
                                        this.suggest(`${possibleFile}`, {
                                            type: "rename-rel",
                                            item: "model",
                                            newName: introspectionModel.name
                                        });
                                    }
                                }
                            }
                        }
                        break;
                }
            }
            if(this.appliedIntrospection)
                return this.applyPatches();
        }
        return Object.entries(this.models);
    }

    /** Remap column using updated names. */
    remap(old: string, newMap: string) {
        for (const remapped of Object.entries(this.remapper)) {
            const [fileName, modelAndColumn] = remapped[0].split(":");
            const [model, column] = modelAndColumn.split(".");

            const [toFileName, toModel] = remapped[1].split(":");

            if (`${fileName}:${model}` == old) {
                const { [remapped[0]]: _current, ...rest } = this.remapper;
                this.remapper = rest;
                this.remapper[`${newMap}.${column}`] = _current;
                break;
            }

            if (`${toFileName}:${toModel}` == old) {
                this.remapper[remapped[0]] = newMap;
                break;
            }
        }
        if(this.config.defaultFunctions && this.config.customAttributeFunctions)
        {
            for (const remapped of Object.entries(this.config.defaultFunctions)) {
                const [fileName, modelAndColumn] = remapped[0].split(":");
                const [model, column] = modelAndColumn.split(".");

                if(`${fileName}:${model}` == old)
                {
                    const { [remapped[0]]: _current, ...rest } = this.config.defaultFunctions;
                    this.config.defaultFunctions = rest;
                    this.config.defaultFunctions[`${newMap}.${column}`] = _current;
                    break;
                }
            }
        }
        if(this.config.deprecatedTag && this.config.deprecated)
        {
            for (const remapped of Object.entries(this.config.deprecated)) {
                const [fileName, modelAndColumn] = remapped[0].split(":");
                const [model, column] = modelAndColumn.split(".");

                if(`${fileName}:${model}` == old)
                {
                    const { [remapped[0]]: _current, ...rest } = this.config.deprecated;
                    this.config.deprecated = rest;
                    this.config.deprecated[`${newMap}.${column}`] = _current;
                    break;
                }
            }
        }
        if(this.config.staticTake && this.config.take)
        {
            for (const remapped of Object.entries(this.config.take)) {
                if(remapped[0] == "$global")
                    continue;
                const [fileName, modelAndColumn] = remapped[0].split(":");
                const [model, column] = modelAndColumn.split(".");

                if(`${fileName}:${model}` == old)
                {
                    const { [remapped[0]]: _current, ...rest } = this.config.take;
                    this.config.take = rest;
                    this.config.take[`${newMap}.${column}`] = _current;
                    break;
                }
            }
        }
    }

    /** Get relations for model */
    getRelations(fileModel: string) {
        const columns = this.modelColumns[fileModel];
        if (!columns)
            return [];
        return columns.filter(column => column.constraints.some(constraint => constraint.startsWith("@relation")));
    }

    /** Get all relations referring to model name. */
    getReferredRelations(fileModel: string): {
        model: string,
        column: Column
    }[] {
        const validModels = Object.entries(this.modelColumns).filter(entry => entry[0] != fileModel);
        const array: {
            model: string,
            column: Column
        }[] = [];
        const model = fileModel.split(":")[1];

        validModels.forEach((modelData) => {
            const [modelName, columns] = modelData;
            if (columns && columns.some(column => column.constraints.some((constraint: string) => constraint.startsWith("@relation")) && column.type == model)) {
                columns.filter(column => column.constraints.some((constraint: string) => constraint.startsWith("@relation")) && column.type == model).forEach(column => {
                    array.push({
                        model: modelName,
                        column
                    });
                })
            }
        })
        return array;
    }

    /**Check for cross-file relation conflict fix with mapper. */
    canFixCrossFileWithMapper(fileModel: string) {
        return this.remapper[fileModel] ? this.remapper[fileModel] : false;
    }

    /** Suggest solution for resolving conflict. */
    suggest(item: string, action: Action) {
        this.solutions.push({
            [item]: action
        })
    }

    /** Write schema and delete on end. */
    async writeSchema(path?: string) {
        await writeTempSchema(this.generateSchema(), path);
    }

    /** Generate schema from details. */
    generateSchema() {
        let schema = '';

        // Add generator and datasource
        schema = schema.concat(this.generator ? this.generator : "", "\n\n", this.datasource ? this.datasource : "");

        // Add models
        const fileNameModels = Object.entries(this.modelColumns).filter((fileModelData) => {
            const [fileModel, columns] = fileModelData;
            return !this.getShadowedModels().includes(fileModel) && !this.getExtendedModels().includes(fileModel);
        });

        //Replacement models
        const replacementModels = this.getReplacementModels();
        //Extended models
        const extendedModels = this.getModelsExtended();
        for (const fileModelData of fileNameModels) {
            const [fileModel, columns] = fileModelData;

            if (!columns)
                continue;
            const [fileName, modelName] = fileModel.split(":");
            const modelHeader = `/// ${fileName}\nmodel ${modelName} {\n`;
            let modelBody = '';

            const columnsToUse = [
                ...columns,
                ...replacementModels.includes(fileModel) ? this.createColumnsForShadowedModel(fileModel) : [],
                ...extendedModels.includes(fileModel) ? this.createColumnsForExtendedModel(fileModel) : [],
            ];

            columnsToUse.forEach(column => {
                modelBody = modelBody.concat(`  ${column.name} ${column.type ? column.type : ""} ${column.constraints.join(" ")}\n`);
            });

            schema = schema.concat("\n\n", modelHeader, modelBody, "}");
        }

        const fileNameEnums = Object.entries(this.enums);

        for (const fileEnumData of fileNameEnums) {
            const [fileEnum, en] = fileEnumData;
            const [fileName, enumName] = fileEnum.split(":");

            const enumHeader = `/// ${fileName}\nenum ${enumName} {\n`;
            let enumBody = '';

            en.values.forEach((value) => {
                enumBody = enumBody.concat(`  ${value}\n`);
            });

            schema = schema.concat("\n\n", enumHeader, enumBody, "}");
        }

        for(const generator of Object.values(this.generators).filter(gen => gen.run))
        {
            schema = schema.concat("\n\n", generator.code);
        }

        return `${schema}`;
    }

    /** Get the extended model names that will be enriched. */
    getModelsExtended() {
        if (!this.config.extended)
            this.config.extended = {};
        return Object.entries(this.config.extended).map((extended) => extended[0]);
    }

    /** Create array columns for shadowed models. */
    createColumnsForShadowedModel(fileModel: string): Column[] {
        const shadowedColumns = Object.entries(this.remapper).filter((remapped) => remapped[1] == fileModel).map(remapped => remapped[0]);
        const ref = this.getReferredRelations(fileModel).filter(data => shadowedColumns.includes(`${data.model}.${data.column.name}`)).map(data => {
            const [fileName, modelName] = data.model.split(":");
            return {
                name: pluralize(modelName.toLowerCase(), 2, false),
                type: modelName
            }
        });

        return ref.map((data) => {
            return {
                name: data.name,
                type: `${data.type}[]`,
                constraints: []
            }
        });
    }

    /** Create array columns from parent. */
    createColumnsForExtendedModel(fileModel: string): Column[] {
        if (!this.config.extended)
            this.config.extended = {};
        return this.modelColumns[this.config.extended[fileModel]].filter(column => !column.constraints.includes("@id") && !column.constraints.includes("@relation"));
    }
}
