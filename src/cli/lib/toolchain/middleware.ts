import { log } from "../../logger.js";
import * as fs from 'fs/promises';
import { convertPathToLocal } from "../../utils.js";
import path from "path";
import crypto from "crypto";
import chalk from "chalk";

/**
 * A Feature is a middleware that will be generated.
 */
export type Feature = {
    identifier: string;
    code: string;
}
/**
 * Packages are the scope wrappers for middlewares.
 */
export type Package = {
    identifier: string;
    features: Feature[]
}

/**
 * Project Toolchain Middleware API implementation.
 * 
 * This class orchestrates middleware generation and hashing and provides an unified API for using the generated code.
 * It provides an easy way of creating middleware and correct scoping to make sure that Prisma Util users have a smooth experience.
 * 
 * This API is intended for internal use only. You should not instantiate this class, but rather use the exported
 * instance. ({@link MiddlewareToolchainInstance})
 */
class MiddlewareToolchain {
    private processPromise?: Promise<void> = undefined;
    private packages: {
        [identifier: string]: Package
    } = {};

    constructor() {}

    /**
     * Add a middleware to the current queue.
     * @param pack The package name.
     * @param name The name of this middleware.
     * @param code The code for this middleware.
     * @returns This instance for chaining.
     */
    public defineMiddleware(pack: string, name: string, code: string)
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
     * Generate all of the middleware that are currently in the queue.
     */
    public async generate()
    {
        if(this.processPromise)
            return this.processPromise;
        
        log("Prisma Util Toolchain is starting to process the middleware generation queue...", "\n");

        this.processPromise = new Promise(async (resolve) => {
            const packageNames = Object.keys(this.packages);
            const generatedPackageCount: {
                [packageIdentifier: string]: number
            } = {};

            const updateGeneratedRepository = (transaction: string) => {
                generatedPackageCount[transaction] = generatedPackageCount[transaction] ? generatedPackageCount[transaction] + 1 : 1;
            };

            for(const file of (await fs.readdir(convertPathToLocal(path.join("node_modules", "prisma-util", "toolchain", "middleware")))).filter(dirent => !packageNames.includes(dirent)))
            {
                await fs.rm(convertPathToLocal(path.join("node_modules", "prisma-util", "toolchain", "middleware", file)), { recursive: true, force: true });
            }
            for(const pack of Object.entries(this.packages))
            {
                const [packageName, packageData] = pack;
                const featureNames = packageData.features.filter(feature => !["all", "default"].includes(feature.identifier)).map(feature => feature.identifier);
                if(featureNames.length == 0)
                    continue;

                let existing = true;

                const packageRoot = convertPathToLocal(path.join("node_modules", "prisma-util", "toolchain", "middleware", packageName));
                try {
                    await fs.access(packageRoot);
                } catch (err) {
                    existing = false;
                    await fs.mkdir(packageRoot);
                }

                const generatedRoot = path.join(packageRoot, "generated");
                const middlewareLines =
                featureNames.length == 1 ?
`declare const ${featureNames[0]}: (prisma: PrismaClient) => (params: any, next: (args: any) => Promise<any>) => Promise<any>;
export default ${featureNames[0]};` :
`export default middlewareBase;
${featureNames.map(feature => {
    return `import ${feature} from "./generated/${feature}.js";\ndeclare const ${feature}: (prisma: PrismaClient) => (params: any, next: (args: any) => Promise<any>) => Promise<any>;`;
}).join("\n")}
export { ${featureNames.join(", ")} };
`;
                const indexDTS = 
`import { PrismaClient } from '@prisma/client';
declare type AvailableMiddleware = ${featureNames.map(feature => `"${feature}"`).join(" | ")};
declare type ExportedMiddlewareBase = {
    [middlewareName in AvailableMiddleware]: (prisma: PrismaClient) => (params: any, next: (args: any) => Promise<any>) => Promise<any>;
} & {
    /**
     * Add all middleware defined in this folder.
     * 
     * @param prisma The instance of the PrismaClient that will be modified.
     * @returns The instance of the PrismaClient passed as an argument.
     */
    all: (prisma: PrismaClient) => PrismaClient;
};
declare const middlewareBase: ExportedMiddlewareBase;

${middlewareLines}`;
                await fs.writeFile(path.join(packageRoot, "index.d.ts"), indexDTS);
                
                const indexJS = 
featureNames.length == 1 ?
`import ${featureNames[0]} from "./generated/${featureNames[0]}.js";
export default ${featureNames[0]};` :
`${featureNames.map(feature => {
    return `import ${feature} from "./generated/${feature}.js";`
}).join("\n")}

const middlewareBase = {
    all: (prisma) => {
        ${featureNames.map(feature => {
            return `prisma.$use(${feature}(prisma));`;
        }).join("\n")}
        return prisma;
    },
    ${featureNames.join(", ")}
};

export default middlewareBase;
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
`Prisma Util Toolchain has processed the following middleware:
${Object.entries(this.packages).map(pack => {
    return `${chalk.blue(pack[0])}: ${pack[1].features.map(feature => chalk.white(feature.identifier)).join(", ")}`;
}).join("\n")}` : "Prisma Util Toolchain didn't generate any middleware.");
            resolve();
        });
        return this.processPromise;
    }
}

/**
 * Instance of the Project Toolchain Middleware API Implementation.
 * 
 * This is the entry-point to all middleware creation, as it provides an unified interface for generating scoped
 * middleware that are easy to use.
 */
 export const MiddlewareToolchainInstance = new MiddlewareToolchain();