import chalk from "chalk";
import createSpinner from "ora";
import { warn, error, experimental } from "./logger.js";
import { successTag, prismaCLITag } from "./messages.js";
import { flatten, getSchema, endsWithAny, writeTempSchema } from "./utils.js";
import pluralize from "pluralize";
/** Small parser utility to resolve conflicts. */
export default class PrismaParser {
    constructor(config, configPath) {
        this.config = config;
        this.configPath = configPath;
        this.models = {};
        this.modelColumns = {};
        this.solutions = [];
        this.remapper = {};
    }
    /**Get all the columns defined for the models loaded. */
    getModelColumns() {
        return this.modelColumns;
    }
    /** Load .prisma files from config and parse models.*/
    async load() {
        if (!this.config.baseSchema) {
            error("The config file has been reset to include all of the properties and to fix error.");
            process.exit(1);
        }
        if (!this.config.excludeModels) {
            this.config.excludeModels = [];
        }
        if (!this.config.includeFiles || this.config.includeFiles.length == 0) {
            warn("You didn't specify any included files in your config!\n", "\n");
            this.config.includeFiles = [];
        }
        if (this.config.crossFileRelations) {
            experimental("Cross-file relations are enabled.\n", "\n");
            this.remapper = this.config.relations ? this.config.relations : {};
        }
        if (!this.config.extended)
            this.config.extended = {};
        for (const file of [this.config.baseSchema, ...this.config.includeFiles]) {
            const fileData = {};
            let spinner = createSpinner({
                text: `${chalk.gray("Loading schema file from ")}${chalk.blue(file)}${chalk.gray("...")}`,
                prefixText: prismaCLITag
            }).start();
            const text = await getSchema(file);
            spinner.stopAndPersist({
                text: `${chalk.gray("Successfully loaded schema from ")}${chalk.blue(file)}${chalk.gray(".")}`,
                prefixText: '',
                symbol: successTag
            });
            // This is the base schema, parse it to get the generator and datasource.
            if (file == this.config.baseSchema) {
                spinner = createSpinner({
                    text: `${chalk.gray("Checking generator and datasource from ")}${chalk.blue(file)}${chalk.gray("...")}`,
                    prefixText: prismaCLITag
                }).start();
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
                    text: `${chalk.gray("Successfully loaded generators and datasource from ")}${chalk.blue(file)}${chalk.gray(".")}`,
                    prefixText: '',
                    symbol: successTag
                });
                this.generator = generator[1];
                this.datasource = datasource[1];
            }
            spinner = createSpinner({
                text: `${chalk.gray("Adding models from ")}${chalk.blue(file)}${chalk.gray("...")}`,
                prefixText: prismaCLITag
            }).start();
            const regex = /^([mM][oO][dD][eE][lL]\s*([^\s]+)(\s*\{((?=.*\n)[^}]+)\}))/gms;
            for (let modelsForFile; modelsForFile = regex.exec(text);) {
                const modelFull = modelsForFile[1];
                const modelName = modelsForFile[2];
                const modelBody = modelsForFile[4];
                // If the model isn't excluded, grab the columns and add it to the models
                if (!this.config.excludeModels.includes(`${file}:${modelName}`)) {
                    fileData[modelName] = modelFull;
                    const columns = modelBody.split(/[\r\n]+/).filter(line => line.trim()).map(line => line.trim());
                    this.modelColumns[`${file}:${modelName}`] = columns.map(column => {
                        const [name, type, ...constraints] = column.split(" ");
                        return {
                            name, type, constraints
                        };
                    });
                }
            }
            // Add the new models to this specific file
            this.models[file] = fileData;
            spinner.stopAndPersist({
                text: `${chalk.gray("Successfully added models from ")}${chalk.blue(file)}${chalk.gray(".")}`,
                symbol: successTag
            });
        }
        return this;
    }
    /** Get a list of raw models.*/
    getModels() {
        return this.models;
    }
    /** Returns all name conflicts.*/
    getConflicts() {
        const files = this.applyPatches();
        // Will be replaced by the mapper
        const shadowedByMapper = this.getShadowedModels();
        // Won't be added to final schema
        const extendedModels = this.getExtendedModels();
        // Obtain frequency map
        const frequencyMap = {};
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
                    }
                    else {
                        if (!frequencyMap[modelName])
                            frequencyMap[modelName] = 1;
                        else
                            frequencyMap[modelName] = frequencyMap[modelName] + 1;
                    }
                }
            });
        }
        // Generate list of conflicts
        const conflicts = [];
        const mapped = files.map(file => Object.keys(file[1]).map(value => `${file[0]}:${value}`));
        const flattened = flatten(mapped).filter(flat => !shadowedByMapper.includes(flat) && !extendedModels.includes(flat));
        // modelName: fileModelAssociation
        const matching = {};
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
                        "1": filesWithModel[i],
                        "2": filesWithModel[j]
                    });
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
                if (actionData.type == "rename") {
                    this.models[fileName][actionData.newName] = _;
                    this.modelColumns[`${fileName}:${actionData.newName}`] = _columns;
                    this.remap(`${fileName}:${modelName}`, `${fileName}:${actionData.newName}`);
                }
                if (actionData.type == "remap") {
                    this.remapper[actionData.from] = actionData.to;
                }
            }
        }
        return Object.entries(this.models);
    }
    /** Remap column using updated names. */
    remap(old, newMap) {
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
    getRelations(fileModel) {
        const columns = this.modelColumns[fileModel];
        return columns.filter(column => column.constraints.some(constraint => constraint.startsWith("@relation")));
    }
    /** Get all relations referring to model name. */
    getReferredRelations(fileModel) {
        const validModels = Object.entries(this.modelColumns).filter(entry => entry[0] != fileModel);
        const array = [];
        const model = fileModel.split(":")[1];
        validModels.forEach((modelData) => {
            const [modelName, columns] = modelData;
            if (columns.some(column => column.constraints.some((constraint) => constraint.startsWith("@relation")) && column.type == model)) {
                columns.filter(column => column.constraints.some((constraint) => constraint.startsWith("@relation")) && column.type == model).forEach(column => {
                    array.push({
                        model: modelName,
                        column
                    });
                });
            }
        });
        return array;
    }
    /**Check for cross-file relation conflict fix with mapper. */
    canFixCrossFileWithMapper(fileModel) {
        return this.remapper[fileModel] ? this.remapper[fileModel] : false;
    }
    /** Suggest solution for resolving conflict. */
    suggest(item, action) {
        this.solutions.push({
            [item]: action
        });
    }
    /** Write schema and delete on end. */
    async writeSchema(path) {
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
            const [fileName, modelName] = fileModel.split(":");
            const modelHeader = `model ${modelName} {\n`;
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
        return schema;
    }
    /** Get the extended model names that will be enriched. */
    getModelsExtended() {
        return Object.entries(this.config.extended).map((extended) => extended[0]);
    }
    /** Create array columns for shadowed models. */
    createColumnsForShadowedModel(fileModel) {
        const shadowedColumns = Object.entries(this.remapper).filter((remapped) => remapped[1] == fileModel).map(remapped => remapped[0]);
        const ref = this.getReferredRelations(fileModel).filter(data => shadowedColumns.includes(`${data.model}.${data.column.name}`)).map(data => {
            const [fileName, modelName] = data.model.split(":");
            return {
                name: pluralize(modelName.toLowerCase(), 2, false),
                type: modelName
            };
        });
        return ref.map((data) => {
            return {
                name: data.name,
                type: `${data.type}[]`,
                constraints: []
            };
        });
    }
    /** Create array columns from parent. */
    createColumnsForExtendedModel(fileModel) {
        return this.modelColumns[this.config.extended[fileModel]].filter(column => !column.constraints.includes("@id") && !column.constraints.includes("@relation"));
    }
}
