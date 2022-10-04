import chalk from "chalk";
import createSpinner from "ora";
import { warn, error, experimental } from "./logger.js";
import { successTag, prismaCLITag } from "./messages.js";
import { flatten, getSchema, endsWithAny, writeTempSchema, runPrismaCommand, convertPathToLocal } from "./utils.js";
import pluralize from "pluralize";
import * as fs from 'fs/promises';
import path from "path";

/** Config type for prisma-util.config.mjs.*/
export type ConfigType = {
    /**Which .prisma files should be included. */
    includeFiles: string[],
    /**Allows exclusion of specific models. */
    excludeModels: string[],
    /**Base schema that provides the datasource and generator. */
    baseSchema: string,
    /**Whether Prisma Util should try to resolve cross-file relation conflicts. */
    crossFileRelations: boolean
    /** Allows extension of models (inheritance).
     * Example: 
     * 
     * "base.prisma:Topic": "schema.prisma:Post"
     * 
     * This example will add all of the non-ID non-relation columns from Post to Topic.
     */
    extended: {
        [fileModel: string]: string
    }
    /** Relation map for resolving cross-file conflicts.
     * Example:
     * 
     * "base.prisma:User": "schema.prisma:BaseUser"
     * 
     * This example will change the type on the column from User to BaseUser. If there are name conflicts, the left one will always be replaced with the right one.
     */
    relations: {
        [fileModel: string]: string
    }
    /**Whether code-generated schemas should be enabled or not. */
    codeSchemas: boolean,
    /**Schema generators that use the @prisma-util/schema-creator package. */
    codeGenerators: Promise<string>[],
    /**pg_trgm support */
    pgtrgm: boolean,
    /**Full-text search support.*/
    ftsIndexes: {
        [fileModel: string]: {
            type: "GIN" | "GIST",
            indexes: {
                language: string,
                field: string,
                weight: string
            }[]
        }
    },
    /** Postgres schema. */
    schema: string;
    /** Middleware generation path. */
    middleware: string;
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
        this.configPath = configPath;
        this.models = {};
        this.modelColumns = {};
        this.solutions = [];
        this.remapper = {};
        this.enums = {};
    }

    /** Load .prisma files from config and parse models.*/
    async load() {
        if (!this.config.baseSchema) {
            error("The config file has been reset to include all of the properties and to fix errors.");
            process.exit(1);
        }
        if (!this.config.excludeModels) {
            this.config.excludeModels = [];
        }
        let experimentalCount = 0;
        if (!this.config.includeFiles || this.config.includeFiles.length == 0) {
            warn("You didn't specify any included files in your config!\n", "\n")
            this.config.includeFiles = [];
        }
        if (this.config.crossFileRelations) {
            experimental("Cross-file relations are enabled.\n", "\n");
            experimentalCount++;
            this.remapper = this.config.relations ? this.config.relations : {};
        }
        if (this.config.codeSchemas) {
            experimental("Code-generated schemas are enabled.\n", experimentalCount == 0 ? "\n" : "");
            experimentalCount++;
        }
        if (this.config.pgtrgm) {
            experimental("pg_trgm support is enabled.\n", experimentalCount == 0 ? "\n" : "");

            if(!this.config.middleware)
            {
                error("You didn't set a middleware path in the configuration file.", "\n");
                process.exit(1);
            }

            if(!this.config.schema)
            {
                error("You didn't set a schema in the configuration file.", "\n");
                process.exit(1);
            }
            experimentalCount++;
        }
        if (!this.config.extended)
            this.config.extended = {};

        const includeFiles: {
            data: string,
            type: "FILE" | "SCHEMA",
            additionalName?: string
        }[] = [this.config.baseSchema, ...this.config.includeFiles].map((val) => {
            return {
                type: "FILE",
                data: val
            };
        });

        for(let i = 0; i < this.config.codeGenerators.length; i++)
        {
            const generator = this.config.codeGenerators[i];
            let spinner = createSpinner({
                text: `${chalk.gray("Running code-schema generator ")}${chalk.blue(`#${i+1}`)}${chalk.gray("...")}`,
                prefixText: prismaCLITag
            }).start();

            includeFiles.push({
                type: "SCHEMA",
                data: await generator,
                additionalName: `#${i + 1}`
            });

            spinner.stopAndPersist({
                text: `${chalk.gray("Successfully generated schema from generator ")}${chalk.blue(`#${i+1}`)}${chalk.gray(".")}`,
                prefixText: '',
                symbol: successTag
            });
        }
        for (const file of includeFiles) {
            const fileData: {
                [name: string]: string
            } = {};
            if(typeof file.data == "function")
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
            for (let enumsForFile; enumsForFile = enumRegex.exec(text);)
            {
                const enumName = enumsForFile[2];
                const enumBody = enumsForFile[4];

                if(!this.config.excludeModels.includes(`${name}:${enumName}`))
                {
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

        for(const fileModel of Object.keys(this.config.ftsIndexes))
        {
            this.modelColumns[fileModel].push({
                name: "textSearch",
                type: "Unsupported(\"TSVECTOR\")?",
                constraints: []
            }, {
                name: "@@index([textSearch])",
                type: "",
                constraints: []
            });
        }

        return this;
    }

    /** Get a list of raw models.*/
    getModels() {
        return this.models;
    }

    /** Change migration to accomodate full-text search indexes. */
    async migrate(command: string)
    {
        if(!this.config.pgtrgm)
            return false;

        try {
            await fs.mkdir(convertPathToLocal("./node_modules/.bin/migrations"));
        } catch (err) {}

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
        if(detected)
        {
            experimental(`Migration created successfully, detected: ${chalk.bold(detected)}.`, "\n");
        }
        else
        {
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

        for (let tables; tables = createTableRegex.exec(migration);)
        {
            const tableName = tables[1];
            const tableBody = tables[2];

            if(!tableBody.includes(`"textSearch" TSVECTOR`))
                continue;

            const toReplace = `CREATE TABLE "${tableName}" (${tableBody});`;
            migrationTables[tableName] = toReplace;
            original[tableName] = toReplace;
        }

        for (let altered; altered = alterTableRegex.exec(migration);)
        {
            const tableName = altered[1];
            const action = altered[2];
            alteredTables[tableName] = action;
        }

        for(const [fileModel, ftsIndex] of Object.entries(this.config.ftsIndexes))
        {
            const [file, model] = fileModel.split(":");
            migration = migration.replace(`"${model}"("textSearch")`, `"${model}" USING ${ftsIndex.type} ("textSearch")`);

            const current = migrationTables[model];

            if(current)
            {
                const toReplace = `TSVECTOR GENERATED ALWAYS AS (${ftsIndex.indexes.map(index => {
                    return `setweight(to_tsvector('${index.language}', coalesce("${index.field}", '')), '${index.weight}')`
                }).join(" || ")}) STORED`;
                migrationTables[model] = current.replace(/TSVECTOR/gms, toReplace);
            }

            const currentAltered = alteredTables[model];
            if(currentAltered)
            {
                const toReplace = `ALTER TABLE "${model}" ${currentAltered} COLUMN "textSearch" TSVECTOR GENERATED ALWAYS AS (${ftsIndex.indexes.map(index => {
                    return `setweight(to_tsvector('${index.language}', coalesce("${index.field}", '')), '${index.weight}')`
                }).join(" || ")}) STORED`;
                migration = migration.replace(`ALTER TABLE "${model}" ${currentAltered} COLUMN "textSearch" TSVECTOR`, toReplace);
            }
        }

        for(const [table, body] of Object.entries(migrationTables))
        {
            migration = migration.replace(original[table], body);
        }

        const migrationText = 
`-- [EXPERIMENTAL] Prisma Util has generated the lines below to accomodate full-text search indexes.\n
CREATE EXTENSION IF NOT EXISTS pg_trgm;\n
-- [EXPERIMENTAL] The lines below are NOT generated by Prisma Util.\n
${migration}`;
        await fs.writeFile(migrationPath, migrationText);

        experimental(`Migration ${chalk.bold(detected)} updated to accomodate full-text search indexes.`, "\n");

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

const MAPPED_SYMBOLS: {
    [data: string]: (first: any, second: any | any[], mode?: "default" | "insensitive") => Prisma.Sql
} = {
    isEmpty: (first: any, second: boolean, mode: "default" | "insensitive" = "default") => Prisma.sql\`\${Prisma.raw(second ? \`\${first} = '{}'\` : \`\${first} <> '{}'\`)}\`,
    equals: (first: any, second: any | any[], mode: "default" | "insensitive" = "default") => Prisma.sql\`\${Prisma.raw(first)} = \${second}\`,
    has: (first: any, second: any, mode: "default" | "insensitive" = "default") => Prisma.sql\`\${Prisma.raw(first)} @> \${[second]}\`,
    hasEvery: (first: any, second: any[], mode: "default" | "insensitive" = "default") => Prisma.sql\`\${Prisma.raw(first)} @> \${second}\`,
    hasSome: (first: any, second: any[], mode: "default" | "insensitive" = "default") => Prisma.sql\`\${Prisma.raw(first)} && \${second}\`,
    not: (first: any, second: any, mode: "default" | "insensitive" = "default") => Prisma.sql\`\${Prisma.raw(first)} <> \${second}\`,
    in: (first: any, second: any[], mode: "default" | "insensitive" = "default") => Prisma.sql\`\${Prisma.raw(first)} IN (\${Prisma.join(second)})\`,
    notIn: (first: any, second: any[], mode: "default" | "insensitive" = "default") => Prisma.sql\`\${Prisma.raw(first)} NOT IN (\${Prisma.join(second)})\`,
    lt: (first: any, second: any, mode: "default" | "insensitive" = "default") => Prisma.sql\`\${Prisma.raw(first)} < \${second}\`,
    lte: (first: any, second: any, mode: "default" | "insensitive" = "default") => Prisma.sql\`\${Prisma.raw(first)} <= \${second}\`,
    gt: (first: any, second: any, mode: "default" | "insensitive" = "default") => Prisma.sql\`\${Prisma.raw(first)} > \${second}\`,
    gte: (first: any, second: any, mode: "default" | "insensitive" = "default") => Prisma.sql\`\${Prisma.raw(first)} >= \${second}\`,
    contains: (first: any, second: any, mode: "default" | "insensitive" = "default") => mode == "default" ? Prisma.sql\`\${Prisma.raw(first)} LIKE \${second}\` : Prisma.sql\`\${Prisma.raw(first)} ILIKE \${\`%\${second}%\`}\`,
    endsWith: (first: any, second: any, mode: "default" | "insensitive" = "default") => mode == "default" ? Prisma.sql\`\${Prisma.raw(first)} LIKE \${second}}\` : Prisma.sql\`\${Prisma.raw(first)} ILIKE \${\`\${second}%\`}\`,
    startsWith: (first: any, second: any, mode: "default" | "insensitive" = "default") => mode == "default" ? Prisma.sql\`\${Prisma.raw(first)} LIKE \${second}\` : Prisma.sql\`\${Prisma.raw(first)} ILIKE \${\`%\${second}\`}\`
}

function check(object: [string, any], MAPPED_COLUMNS: string[]): boolean
{
    const [key, filter] = object;
    if(BLOCK_FILTERS.includes(key))
        return Object.entries(filter).some((val) => check(val, MAPPED_COLUMNS));
    return typeof filter == "string" && MAPPED_COLUMNS.includes(key);
}

function flatten<T>(array: any[][]): T[] {
    return array.reduce(function (flatArray, arrayToFlatten) {
      return flatArray.concat(Array.isArray(arrayToFlatten) ? flatten(arrayToFlatten) : arrayToFlatten);
    }, []);
}

const middleware = (prisma: PrismaClient) => async (params: Prisma.MiddlewareParams, next: (params: Prisma.MiddlewareParams) => Promise<any>) => {

    if(!ALLOWED_ACTIONS.includes(params.action))
        return next(params);

    if(!params.model || !MAPPED_MODELS.includes(params.model))
        return next(params);

    const MAPPED_COLUMNS: string[] = (MAPPED_COLUMNS_MODELS as any)[params.model];
    if(!Object.entries(params.args.where).some((val) => check(val, MAPPED_COLUMNS)))
        return next(params);

    const table: string = \`"\${schema}"."\${params.model}"\`;
    const limit = params.action == "findFirst" ? 1 : params.args.take ? params.args.take : 0;
    const offset = params.args.skip ? params.args.skip : 0;
    const selectedColumns: (Prisma.Sql)[] | Prisma.Sql = params.args.select ? ([...new Set(Object.keys(params.args.where).map(key => [key, true]).concat(Object.entries(params.args.select)).map(data => {
        return data[1] ? \`\${table}."\$\{data[0]}"\` : null;
    }).filter(String))] as string[]).map(val => Prisma.raw(val)) : ((prisma as any)["_baseDmmf"]["typeAndModelMap"][params.model]["fields"].filter((item: any) => !item.relationName).map((field: any) => [field.name, true]).map((data: [string, boolean]) => {
        return data[1] ? \`\${table}."\${data[0]}"\` : null;
    })).map((val: string) => Prisma.raw(val));
    const orderBy: [string, string] | null = params.args.orderBy ? Object.entries(params.args.orderBy)[0] as [string, string] : null;
    const matches: {
        [column: string]: string
    } = {};
    const cursor = params.args.cursor ? Object.entries(params.args.cursor).map(entry => [\`\${table}."\${entry[0]}"\`, entry[1]]).map((entry: any) => Prisma.sql\`\${Prisma.raw(entry[0])} > \${entry[1] as number}\`) : [];

    function doFilter(root: any, obj: [string, unknown][], first: boolean, action?: string)
    {
        const object = Object.fromEntries(obj);
        let and = object["AND"];
        let or = object["OR"];
        let not = object["NOT"];

        const intFilters = 
            flatten<Prisma.Sql>(obj
                .filter(entry => Object.keys(entry[1] as object).some(key => INT_FILTERS.includes(key)))
                .map(entry => [\`\${table}."\${entry[0]}"\`, entry[1]]).map((entry: any) => {
                    const data = Object.entries(entry[1])
                        .filter(en => (typeof en[1] == "number" || (Array.isArray(en[1]) && typeof (en[1] as any[])[0] == "number") && en[0] != "equals"))
                        .map(en => {
                            return MAPPED_SYMBOLS[en[0]].apply(root, [entry[0], en[1] as any]);
                        });
                    return data;
                }));
        
        const baseIntFilters = 
            flatten<Prisma.Sql>(obj
                .map(entry => [\`\${table}."\${entry[0]}"\`, entry[1]])
                .filter(entry => typeof entry[1] != "object")
                .map((entry: any) => {
                    const data = Object.entries(entry[1])
                        .filter(en => (typeof en[1] == "number"))
                        .map(en => {
                            return MAPPED_SYMBOLS.equals.apply(root, [entry[0], en[1] as any]);
                        });
                    return data;
                }));
        const baseStringFilters = 
            flatten<Prisma.Sql>(obj
                .filter(entry => typeof entry[1] == "string")
                .map((entry: any) => {                    
                    if(MAPPED_COLUMNS.includes(entry[0]))
                    {
                        matches[entry[0]] = entry[1];
                        return [Prisma.sql\`(\${Prisma.raw(entry[0])} % \${entry[1]})\`];
                    }
                    entry[0] = \`\${table}."\${entry[0]}"\`;
                    return [MAPPED_SYMBOLS.equals.apply(root, [entry[0], entry[1] as any])];
                }));
        const stringFilters = 
            flatten<Prisma.Sql>(obj
                .filter(entry => Object.keys(entry[1] as object).some(key => STRING_FILTERS.includes(key)))
                .map(entry => [\`\${table}."\${entry[0]}"\`, entry[1]])
                .map((entry: any) => {
                    const data = Object.entries(entry[1])
                        .filter(en => en[0] != "mode" && typeof en[1] == "string" || (Array.isArray(en[1]) && typeof (en[1] as any[])[0] == "string" && en[0] != "equals"))
                        .map(en => {
                            return MAPPED_SYMBOLS[en[0]].apply(root, [entry[0], en[1] as any, entry[1].mode ? entry[1].mode : "default"]);
                        });
                    return data;
                }));
        const scalarFilters = 
            flatten<Prisma.Sql>(obj
                .filter(entry => Object.keys(entry[1] as object).some(key => SCALAR_FILTERS.includes(key)))
                .map(entry => [\`\${table}."\${entry[0]}"\`, entry[1]])
                .map((entry: any) => {
                    const data = Object.entries(entry[1])
                        .filter(en => (Array.isArray(en[1]) || typeof en[1] == "boolean" && en[0] == "isEmpty"))
                        .map(en => {
                            return MAPPED_SYMBOLS[en[0]].apply(root, [entry[0], en[1] as any]);
                        });
                    return data;
                }));

        const conditions: Prisma.Sql[] = 
        [
            ...(intFilters.length > 0 ? intFilters : []),
            ...(stringFilters.length > 0 ? stringFilters : []),
            ...(scalarFilters.length > 0 ? scalarFilters : []),
            ...(baseIntFilters.length > 0 ? baseIntFilters : []),
            ...(baseStringFilters.length > 0 ? baseStringFilters : []),
        ];

        let AND, OR, NOT;
        if(and)
            AND = doFilter(root, Object.entries(and as any), false, "AND");
        if(or)
            OR = doFilter(root, Object.entries(or as any), false, "OR");
        if(not)
            NOT = doFilter(root, Object.entries(not as any), false, "NOT");

        const data: Prisma.Sql[] = 
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

    const conditions: Prisma.Sql[] = 
    [
        ...(cursor.length > 0 ? cursor : []),
        ...(blockFilters.length > 0 ? blockFilters : []),
    ];

    return prisma.$queryRaw\`SELECT \${Array.isArray(selectedColumns) ? Prisma.join(selectedColumns) : selectedColumns}\${orderBy ? Prisma.sql\`, SIMILARITY(\${Prisma.raw(orderBy[0])}, \${matches[orderBy[0]]}) as ftsScore\` : Prisma.empty} FROM \${Prisma.raw(table)} WHERE (\${Prisma.join(conditions, " AND ")})\${orderBy ? Prisma.sql\` ORDER BY ftsScore \${Prisma.raw(orderBy[1].toUpperCase())}\` : Prisma.empty}\${limit > 0 ? Prisma.sql\` LIMIT \${limit}\` : Prisma.empty}\${offset > 0 ? Prisma.sql\` OFFSET \${offset}\` : Prisma.empty}\`;
};

export default middleware;`;

        await fs.writeFile(convertPathToLocal(this.config.middleware), code);

        experimental(`Wrote middleware to ${chalk.bold(this.config.middleware)}.`, "\n");
        return true;
    }

    /** Returns all name conflicts.*/
    getConflicts() {
        const files = this.applyPatches();
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
        return Object.entries(this.config.extended).map((extended) => {
            const [toMapFileName, toMapModelName] = extended[1].split(":");
            return `${toMapFileName}:${toMapModelName}`;
        });
    }

    /** Get the model names that will be enriched by the mapper. */
    getReplacementModels() {
        return Object.entries(this.remapper).map((remapped) => remapped[1]);
    }

    /** Apply solutions to conflicts. */
    applyPatches() {
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

                if(actionData.item == "enum")
                {
                    const { [`${fileName}:${modelName}`]: _, ...object } = this.enums;
                    this.enums = object;
                    _enum = _;
                }

                if (actionData.type == "rename") {
                    if(actionData.item == "enum")
                    {
                        if(_enum)
                        {
                            this.enums[`${fileName}:${actionData.newName}`] = _enum;
                            this.models[fileName][actionData.newName] = _enum.values.join("\n");
                        }
                    } else
                    {
                        this.models[fileName][actionData.newName] = _;
                        this.modelColumns[`${fileName}:${actionData.newName}`] = _columns;
                        this.remap(`${fileName}:${modelName}`, `${fileName}:${actionData.newName}`);
                    }
                }

                if (actionData.type == "remap") {
                    this.remapper[actionData.from] = actionData.to;
                }
            }
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
    }

    /** Get relations for model */
    getRelations(fileModel: string) {
        const columns = this.modelColumns[fileModel];
        if(!columns)
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

            if(!columns)
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
                modelBody = modelBody.concat(`  ${column.name} ${column.type} ${column.constraints.join(" ")}\n`);
            });

            schema = schema.concat("\n\n", modelHeader, modelBody, "}");
        }

        const fileNameEnums = Object.entries(this.enums);

        for(const fileEnumData of fileNameEnums)
        {
            const [fileEnum, en] = fileEnumData;
            const [fileName, enumName] = fileEnum.split(":");

            const enumHeader = `/// ${fileName}\nenum ${enumName} {\n`;
            let enumBody = '';

            en.values.forEach((value) => {
                enumBody = enumBody.concat(`  ${value}\n`);
            });

            schema = schema.concat("\n\n", enumHeader, enumBody, "}");
        }

        return schema;
    }

    /** Get the extended model names that will be enriched. */
    getModelsExtended() {
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
        return this.modelColumns[this.config.extended[fileModel]].filter(column => !column.constraints.includes("@id") && !column.constraints.includes("@relation"));
    }
}
