import { log } from "../../logger.js";
import * as fs from 'fs/promises';
import { convertPathToLocal } from "../../utils.js";
import path from "path";
import crypto from "crypto";
import chalk from "chalk";

/**
 * A Feature is an extension that will be generated.
 */
export type Feature = {
    identifier: string;
    code: string;
}
/**
 * Packages are the scope wrappers for extensions.
 */
export type Package = {
    identifier: string;
    features: Feature[]
}

/**
 * Project Toolchain Extension API implementation.
 * 
 * This class orchestrates extension generation and hashing and provides an unified API for using the generated code.
 * It provides an easy way of creating extensions and correct scoping to make sure that Prisma Util users have a smooth experience.
 * 
 * This API is intended for internal use only. You should not instantiate this class, but rather use the exported
 * instance. ({@link ExtensionToolchainInstance})
 */
class ExtensionToolchain {
    private processPromise?: Promise<void> = undefined;
    private packages: {
        [identifier: string]: Package
    } = {};

    constructor() {}

    /**
     * Add an extension to the current queue.
     * @param pack The package name.
     * @param name The name of this extension.
     * @param code The code for this extension.
     * @returns This instance for chaining.
     */
    public defineExtension(pack: string, name: string, code: string)
    {
        if(this.packages[pack])
            this.packages[pack].features.push({
                identifier: name,
                code
            });
        else
            this.packages[pack] = {
                identifier: pack,
                features: [{
                    identifier: name,
                    code
                }]
            };
        return this;
    }

    /**
     * Generate all of the extensions that are currently in the queue.
     */
    public async generate()
    {
        if(this.processPromise)
            return this.processPromise;
        
        log("Prisma Util Toolchain is starting to process the extensions generation queue...", "\n");

        this.processPromise = new Promise(async (resolve) => {
            const packageNames = Object.keys(this.packages);
            const generatedPackageCount: {
                [packageIdentifier: string]: number
            } = {};

            const updateGeneratedRepository = (transaction: string) => {
                generatedPackageCount[transaction] = generatedPackageCount[transaction] ? generatedPackageCount[transaction] + 1 : 1;
            };

            for(const file of (await fs.readdir(convertPathToLocal(path.join("node_modules", "prisma-util", "toolchain", "extensions")))).filter(dirent => !packageNames.includes(dirent)))
            {
                await fs.rm(convertPathToLocal(path.join("node_modules", "prisma-util", "toolchain", "extensions", file)), { recursive: true, force: true });
            }
            for(const pack of Object.entries(this.packages))
            {
                const [packageName, packageData] = pack;
                const featureNames = packageData.features.filter(feature => !["all", "default"].includes(feature.identifier)).map(feature => feature.identifier);
                if(featureNames.length == 0)
                    continue;

                let existing = true;

                const packageRoot = convertPathToLocal(path.join("node_modules", "prisma-util", "toolchain", "extensions", packageName));
                try {
                    await fs.access(packageRoot);
                } catch (err) {
                    existing = false;
                    await fs.mkdir(packageRoot);
                }

                const generatedRoot = path.join(packageRoot, "generated");
                const extensionsLines =
                featureNames.length == 1 ?
`export default function extension(prisma: PrismaClient): Omit<PrismaClient, "$use" | "$unuse">;` :
`export default extensionsBase;
${featureNames.map(feature => {
    return `import ${feature} from "./generated/${feature}.js";\ndeclare const ${feature}: (prisma: PrismaClient) => Omit<PrismaClient, "$use" | "$unuse">;`;
}).join("\n")}
export { ${featureNames.join(", ")} };
`;
                const indexDTS = 
`import { PrismaClient } from '@prisma/client';
declare type AvailableExtensions = ${featureNames.map(feature => `"${feature}"`).join(" | ")};
declare type ExportedExtensionsBase = {
    [extensionName in AvailableExtensions]: (prisma: PrismaClient) => Omit<PrismaClient, "$use" | "$unuse">;
} & {
    /**
     * Add all extensions defined in this folder.
     * 
     * @param prisma The instance of the PrismaClient that will be modified.
     * @returns The PrismaClient with all extensions added.
     */
    all: (prisma: PrismaClient) => Omit<PrismaClient, "$use" | "$unuse">;
};
declare const extensionsBase: ExportedExtensionsBase;

${extensionsLines}`;
                await fs.writeFile(path.join(packageRoot, "index.d.ts"), indexDTS);
                
                const indexJS = 
featureNames.length == 1 ?
`import ${featureNames[0]} from "./generated/${featureNames[0]}.js";
export default ${featureNames[0]};` :
`${featureNames.map(feature => {
    return `import ${feature} from "./generated/${feature}.js";`
}).join("\n")}

const extensionsBase = {
    all: (prisma) => {
        ${featureNames.map(feature => {
            return `prisma = ${feature}(prisma);`;
        }).join("\n")}
        return prisma;
    },
    ${featureNames.join(", ")}
};

export default extensionsBase;
export { ${featureNames.join(", ")} };`;

await fs.writeFile(path.join(packageRoot, "index.js"), indexJS);
                if(!existing)
                {
                    await fs.mkdir(generatedRoot);
                    
                    for(const feature of packageData.features)
                    {
                        await fs.writeFile(`${path.join(generatedRoot, feature.identifier)}.js`, feature.code);
                        updateGeneratedRepository(packageName);
                    }

                    continue;
                }

                const paths = (await fs.readdir(generatedRoot));
                for(const file of paths.filter(dirent => !featureNames.includes(path.parse(dirent).name)))
                {
                    await fs.rm(path.join(generatedRoot, file), { recursive: true, force: true });
                }
                for(const { identifier, code } of packageData.features.filter(feature => paths.includes(`${feature.identifier}.js`)))
                {
                    const fileBuffer = await fs.readFile(`${path.join(generatedRoot, identifier)}.js`);

                    const currentHashSum = crypto.createHash('sha256');
                    currentHashSum.update(fileBuffer);
                    const currentHex = currentHashSum.digest('hex');

                    const newHashSum = crypto.createHash('sha256');
                    newHashSum.update(code);
                    const newHex = newHashSum.digest('hex');

                    if(currentHex == newHex)
                        continue;
                    
                    await fs.writeFile(`${path.join(generatedRoot, identifier)}.js`, code);
                    updateGeneratedRepository(packageName);
                }

                for(const { identifier, code } of packageData.features.filter(feature => !paths.includes(`${feature.identifier}.js`)))
                {
                    await fs.writeFile(`${path.join(generatedRoot, identifier)}.js`, code);
                    updateGeneratedRepository(packageName);
                }
            }

            log(Object.keys(generatedPackageCount).length > 0 ? 
`Prisma Util Toolchain has processed the following extensions:
${Object.entries(this.packages).map(pack => {
    return `${chalk.blue(pack[0])}: ${pack[1].features.map(feature => chalk.white(feature.identifier)).join(", ")}`;
}).join("\n")}` : "Prisma Util Toolchain didn't generate any extensions.");
            resolve();
        });
        return this.processPromise;
    }
}

/**
 * Instance of the Project Toolchain Extensions API Implementation.
 * 
 * This is the entry-point to all extension creation, as it provides an unified interface for generating scoped
 * extensions that are easy to use.
 */
 export const ExtensionsToolchainInstance = new ExtensionToolchain();