/** Config type for prisma-util.config.json.*/
export declare type ConfigType = {
    /**Which .prisma files should be included. */
    includeFiles: string[];
    /**Allows exclusion of specific models. */
    excludeModels: string[];
    /**Base schema that provides the datasource and generator. */
    baseSchema: string;
    /**Whether Prisma Util should try to resolve cross-file relation conflicts. */
    crossFileRelations: boolean;
    /** Allows extension of models (inheritance).
     * Example:
     *
     * "base.prisma:Topic": "schema.prisma:Post"
     *
     * This example will add all of the non-ID non-relation columns from Post to Topic.
     */
    extended: {
        [fileModel: string]: string;
    };
    /** Relation map for resolving cross-file conflicts.
     * Example:
     *
     * "base.prisma:User": "schema.prisma:BaseUser"
     *
     * This example will change the type on the column from User to BaseUser. If there are name conflicts, the left one will always be replaced with the right one.
     */
    relations: {
        [fileModel: string]: string;
    };
};
/** Column type for schema models. */
export declare type Column = {
    name: string;
    type: string;
    constraints: string[];
};
/**Action type for resolving conflicts. */
export declare type Action = {
    type: "skip";
} | {
    type: "rename";
    newName: string;
} | {
    type: "remap";
    from: string;
    to: string;
};
/** Small parser utility to resolve conflicts. */
export default class PrismaParser {
    /**Get all the columns defined for the models loaded. */
    getModelColumns(): any;
    /** All of the models across all .prisma files. */
    models: {
        [file: string]: {
            [name: string]: string;
        };
    };
    /** Columns for models mapped by file-model association. */
    modelColumns: {
        [fileModel: string]: Column[];
    };
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
        [fileModel: string]: string;
    };
    constructor(config: ConfigType, configPath: string);
    /** Load .prisma files from config and parse models.*/
    load(): Promise<this>;
    /** Get a list of raw models.*/
    getModels(): {
        [file: string]: {
            [name: string]: string;
        };
    };
    /** Returns all name conflicts.*/
    getConflicts(): {
        1: string;
        2: string;
    }[];
    /** Get models that will be removed by the mapper. */
    getShadowedModels(): string[];
    /** Get models that will only server as a polyfill. */
    getExtendedModels(): string[];
    /** Get the model names that will be enriched by the mapper. */
    getReplacementModels(): string[];
    /** Apply solutions to conflicts. */
    applyPatches(): [string, {
        [name: string]: string;
    }][];
    /** Remap column using updated names. */
    remap(old: string, newMap: string): void;
    /** Get relations for model */
    getRelations(fileModel: string): Column[];
    /** Get all relations referring to model name. */
    getReferredRelations(fileModel: string): {
        model: string;
        column: Column;
    }[];
    /**Check for cross-file relation conflict fix with mapper. */
    canFixCrossFileWithMapper(fileModel: string): string | false;
    /** Suggest solution for resolving conflict. */
    suggest(item: string, action: Action): void;
    /** Write schema and delete on end. */
    writeSchema(path?: string): Promise<void>;
    /** Generate schema from details. */
    generateSchema(): string;
    /** Get the extended model names that will be enriched. */
    getModelsExtended(): string[];
    /** Create array columns for shadowed models. */
    createColumnsForShadowedModel(fileModel: string): Column[];
    /** Create array columns from parent. */
    createColumnsForExtendedModel(fileModel: string): Column[];
}
