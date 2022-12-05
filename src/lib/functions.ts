import { getConfig } from "./config.js";

export default function getMappings()
{
    const config = getConfig();

    if(!config.defaultFunctions)
        return { columnMappings: {}, modelMappings: {} };

    const entries = Object.entries(config.defaultFunctions).map(entry => {
        return [entry[0].split(":")[1], entry[1]] as [string, Function];
    });

    const columnMappings = Object.fromEntries(entries);

    const modelMappings: {
        [model: string]: {
            [column: string]: Function
        }
    } = {};
    
    for(const [modelColumn, func] of entries)
    {
        const [modelName, columnName] = modelColumn.split(".");
        if(modelMappings[modelName])
            modelMappings[modelName][columnName] = func;
        else
            modelMappings[modelName] = { [columnName]: func };
    }

    return { columnMappings, modelMappings };
}

export function getStaticTake()
{
    const config = getConfig();
    if(!config.take)
        return {};
    return config.take;
}