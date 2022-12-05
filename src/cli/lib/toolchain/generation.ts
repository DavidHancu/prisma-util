import { convertPathToLocal, normalizePath } from "../../utils.js";
import * as fs from 'fs/promises';
import { log } from '../../logger.js';
import chalk from "chalk";

/**
 * Project Toolchain asset representing a PrismaClient file and its name inside the Generation Toolchain.
 * This type is used to initialize the Generation Toolchain.
 * 
 * The key of this object represents the code name of this asset.
 * The value of this object represents the path of the asset relative to the project root.
 */
type AssetBundle = {
    [key: string]: string | AssetBundle
};

/**
 * Safe null for strings.
 */
const SAFE_NULL_STRING = "<NULL>";

/**
 * Ignore search step.
 */
export const IGNORE_SEARCH_STEP = "<IGNORE_SEARCH>";

/**
 * Check if a string is valid.
 * @param checked The string to check.
 * @returns Whether the checked string is valid or not.
 */
function validString(checked?: string): boolean {
    return !(!checked) && checked != SAFE_NULL_STRING;
}

/**
 * Project Toolchain default assets to be used in the Generation Toolchain.
 * 
 * This map includes all runtime declarations of `@prisma/client/runtime`:
 * 
 *      PRISMA_CLIENT_RUNTIME: {
 *          EDGE: "node_modules/@prisma/client/runtime/edge.js",
 *          EDGE_ESM: "node_modules/@prisma/client/runtime/edge-esm.js",
 *          INDEX: "node_modules/@prisma/client/runtime/index.js",
 *      }
 * 
 * This map includes all generated declarations of `.prisma/client`:
 * 
 *      PRISMA_CLIENT_GENERATED: {
 *          EDGE: "node_modules/.prisma/client/edge.js",
 *          INDEX: "node_modules/.prisma/client/index.js",
 *          INDEX_TYPES: "node_modules/.prisma/client/index.d.ts",
 *      }
 */
const DEFAULT_ASSETS = {
    PRISMA_CLIENT_RUNTIME: {
        EDGE: "node_modules/@prisma/client/runtime/edge.js",
        EDGE_ESM: "node_modules/@prisma/client/runtime/edge-esm.js",
        INDEX: "node_modules/@prisma/client/runtime/index.js",
    },
    PRISMA_CLIENT_GENERATED: {
        EDGE: "node_modules/.prisma/client/edge.js",
        INDEX: "node_modules/.prisma/client/index.js",
        INDEX_TYPES: "node_modules/.prisma/client/index.d.ts",
    }
}

/**
 * Escape a search query.
 * @param string The string to escape.
 * @returns Escaped string to use inside of regex.
 */
function escapeRegex(string: string) {
    return string.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
}

/**
 * The strategy that the Generation Toolchain should use for an {@link EditTransaction}.
 */
export enum EditStrategy {
    REGEX, JOIN, REPLACE, REPLACE_UNSAFE, REPLACE_FULL, NONE
}

/**
 * Project Toolchain backend implementation.
 * 
 * This class orchestrates code generation and editing and provides an unified API for using the generated code. 
 * It provides utilities as well as state handling between edits to make sure that the correct code is written.
 * 
 * This API is intended for internal use only. You should not instantiate this class, but rather use the exported 
 * instance. ({@link GenerationToolchainInstance})
 */
class GenerationToolchain {
    private _assets: AssetBundle & typeof DEFAULT_ASSETS = DEFAULT_ASSETS;
    private queue: EditTransaction[] = [];
    private processPromise?: Promise<void> = undefined;
    private _useExtensions: boolean = false;

    constructor() {

    }

    /**
     * Use extensions instead of code edits.
     * @param useExtensions Whether extensions should be used or not.
     * @returns This instance for chaining.
     */
    public useExtensions(useExtensions: boolean): GenerationToolchain
    {
        this._useExtensions = useExtensions;
        return this;
    }

    /**
     * Returns the current repository of assets.
     */
    public get ASSETS(): AssetBundle & typeof DEFAULT_ASSETS {
        return this._assets;
    }

    /**
     * This function allows you to add assets that you can use later when generating.
     * @param assets The assets that should be added to the repository.
     */
    public addAssets(assets: AssetBundle) {
        this._assets = {
            ...assets,
            ...this._assets
        };
    }

    /**
     * Create a transaction to modify internal assets from PrismaClient.
     * @returns An {@link EditTransaction} that you can use to modify internal assets.
     */
    public createEditTransaction(): EditTransaction {
        return new EditTransaction(this);
    }

    /**
     * Add an edit transaction to the processing queue. Transactions are processed sequentially and can't
     * be created while the Generation Toolchain is processing.
     * @param transaction The transaction that should be queued.
     * @returns True if the transaction has been added to the queue, false otherwise.
     */
    public queueEditTransaction(transaction: EditTransaction): boolean {
        if (!this.processPromise)
            this.queue.push(transaction);
        return !this.processPromise;
    }

    /**
     * Start processing the transaction queue.
     * @returns A Promise that will resolve when processing finishes.
     */
    public process(): Promise<void> {
        if (this.processPromise)
            return this.processPromise;

        log("Prisma Util Toolchain is starting to process the transaction queue...", "\n");
        this.processPromise = new Promise(async (resolve) => {
            const transactionRepository: {
                [assetPath: string]: string
            } = {};
            const processedTransactions: string[] = [];
            const processedBlocksForTransactions: {
                [path: string]: number
            } = {};

            const useTransactionRepository = async (requestedKey: string) => {
                if (!transactionRepository[requestedKey])
                    transactionRepository[requestedKey] = await fs.readFile(requestedKey, "utf8");
                return transactionRepository[requestedKey];
            };

            const updateTransactionRepository = (assetPath: string, text: string) => {
                transactionRepository[assetPath] = text;
            };

            while (this.queue.length > 0) {
                const transaction = this.queue.pop();
                if (!transaction)
                    continue;

                const requestedAsset = transaction?.changedAsset;
                if (!validString(requestedAsset))
                    continue;
                const assetPath = convertPathToLocal(requestedAsset);

                const blocks = this._useExtensions ? transaction.blocks.filter(block => block.ignoreExtensions) : transaction.blocks;
                let processedCount = 0;

                for (const block of blocks) {
                    const { from, to, ammend, strategy, search } = block;
                    let snapshot: string = "";
                    let text: string = "";

                    if (EditStrategy.REPLACE_FULL != strategy && typeof from != "string" && typeof to != "string") {
                        snapshot = await useTransactionRepository(assetPath);

                        text = snapshot;
                        text = text.replace(from, (match, ...g) => {
                            return to(match, ...g);
                        });
                    } else {
                        if(EditStrategy.REPLACE_FULL != strategy)
                        {
                            if (!validString(typeof from == "string" ? from : SAFE_NULL_STRING) || !validString(typeof to == "string" ? to : SAFE_NULL_STRING) || strategy == EditStrategy.NONE)
                                continue;
                        }

                        snapshot = await useTransactionRepository(assetPath);

                        if(EditStrategy.REPLACE_FULL != strategy)
                        {
                            if (new RegExp(escapeRegex(typeof to == "string" ? to : SAFE_NULL_STRING), "gms").test(snapshot))
                                continue;
                        }

                        const regex = new RegExp(escapeRegex(typeof from == "string" ? from : SAFE_NULL_STRING), "gms");

                        if(EditStrategy.REPLACE_FULL != strategy)
                        {
                            if (!regex.test(snapshot))
                                continue;
                        }
                        text = snapshot;

                        switch (strategy) {
                            case EditStrategy.REGEX:
                                const lines = text.split("\n");
                                const item = lines.filter(line => regex.test(line))[0];

                                if (!item)
                                    continue;

                                let index = lines.indexOf(item);

                                if (index == -1)
                                    continue;

                                index = index + ammend;

                                text = `${lines.slice(0, index).join("\n")}\n${to}\n${lines.slice(index).join("\n")}`;
                                break;
                            case EditStrategy.JOIN:
                                text = text.split(regex).join(`${to}${from}`);
                                break;
                            case EditStrategy.REPLACE:
                                text = text.replace(regex, `${from}${to}`);
                                break;
                            case EditStrategy.REPLACE_FULL:
                                text = typeof to == "function" ? `${to(text)}${text}` : text;
                                break;
                        }
                    }

                    updateTransactionRepository(assetPath, text);
                    processedCount++;
                }

                if (processedCount > 0)
                    processedTransactions.push(assetPath);

                processedBlocksForTransactions[assetPath] = processedBlocksForTransactions[assetPath] ? processedBlocksForTransactions[assetPath] + processedCount : processedCount;
            }

            for (const [file, content] of Object.entries(transactionRepository)) {
                await fs.writeFile(file, content);
            }

            const frequencies: {
                [key: string]: number
            } = {};

            for (const transaction of processedTransactions) {
                frequencies[transaction] = frequencies[transaction] ? frequencies[transaction] + 1 : 1;
            }

            const blockCount = Object.values(processedBlocksForTransactions).reduce((partialSum, a) => partialSum + a, 0);

            log(processedTransactions.length > 0 ? `Prisma Util Toolchain has processed the following transactions: \n${[...new Set(processedTransactions)].map(key => `- ${normalizePath(key)} ${chalk.white(chalk.bold(`(${chalk.blue(frequencies[key])} ${frequencies[key] == 1 ? "transaction" : "transactions"}, ${chalk.blue(processedBlocksForTransactions[key])} ${processedBlocksForTransactions[key] == 1 ? "block" : "blocks"})`))}`).join("\n")}\nTOTAL: ${chalk.white(`${chalk.blue(processedTransactions.length)} ${processedTransactions.length == 1 ? "transaction" : "transactions"}, ${chalk.blue(blockCount)} ${blockCount == 1 ? "block" : "blocks"}`)}` : "Prisma Util Toolchain couldn't find any differences, so it didn't process any transactions.");
            resolve();
        });
        return this.processPromise;
    }
}

/**
 * Edit Transaction is an interface that allows you to edit a PrismaClient internal asset without worrying
 * about index shifting or file searching. 
 * 
 * To create an EditTransaction, use the {@link GenerationToolchain.createEditTransaction} function and chain the
 * function calls to this class, then use {@link EditTransaction.end} when you're done.
 */
export class EditTransaction {
    private generationToolchain: GenerationToolchain;
    private requestedAsset: string = SAFE_NULL_STRING;
    private transactionBlocks: EditTransactionBlock[] = [];

    constructor(generationToolchain: GenerationToolchain) {
        this.generationToolchain = generationToolchain;
    }

    /**
     * Returns the path to the requested asset of this transaction.
     */
    public get changedAsset() {
        return this.requestedAsset;
    }

    /**
     * Returns the changes for this transaction.
     */
    public get blocks() {
        return this.transactionBlocks;
    }

    /**
     * Mark this transaction as finished. This function will add the transaction to the queue for edits 
     * and will be processed sequentially.
     * @returns The {@link GenerationToolchain} instance that was used for this transaction.
     */
    public end(): GenerationToolchain {
        this.generationToolchain.queueEditTransaction(this);
        return this.generationToolchain;
    }

    /**
     * Change the asset being edited in this transaction.
     * @param assetName The asset that you want to edit.
     * @returns This transaction for chaining.
     */
    public requestAsset(assetName: string): EditTransaction {
        this.requestedAsset = assetName;
        return this;
    }

    /**
     * Add a transaction block to this edit transaction.
     * 
     * This method isn't supposed to be called manually.
     * 
     * Method Flags: @Internal @NoManual
     * @param transactionBlock The transaction block to add.
     */
    public pushTransactionBlock(transactionBlock: EditTransactionBlock) {
        this.transactionBlocks.push(transactionBlock);
    }

    /**
     * Create a new change for this transaction.
     * @returns A new transaction block.
     */
    public createBlock(): EditTransactionBlock {
        return new EditTransactionBlock(this);
    }
}

/**
 * A transaction block handles a change in a transaction.
 */
export class EditTransactionBlock {
    private editTransaction: EditTransaction;
    strategy: EditStrategy = EditStrategy.NONE;
    from: (string | RegExp) = SAFE_NULL_STRING;
    to: (string | ((...groups: string[]) => string)) = SAFE_NULL_STRING;
    search: string = SAFE_NULL_STRING;
    ammend: number = 0;
    ignoreExtensions: boolean = false;

    public constructor(editTransaction: EditTransaction) {
        this.editTransaction = editTransaction;
    }

    /**
     * Change the edit strategy for this block.
     * @param strategy The new strategy to use.
     * @returns This transaction block for chaining.
     */
    public setStrategy(strategy: EditStrategy): EditTransactionBlock {
        this.strategy = strategy;
        return this;
    }

    /**
     * Disable this block based on extension status.
     * @param ignoreExtensions Whether this block should be ran even if extensions are enabked.
     * @returns This transaction block for chaining.
     */
    public setIgnoreExtensions(ignoreExtensions: boolean): EditTransactionBlock {
        this.ignoreExtensions = ignoreExtensions;
        return this;
    }

    /**
     * Change a line from this asset.
     * @param from The line to search for.
     * @param modifier The value that will be added to the index.
     * @returns This transaction block for chaining.
     */
    public findLine(from: string | RegExp, modifier = 0): EditTransactionBlock {
        this.from = from;
        this.ammend = modifier;
        return this;
    }

    /**
     * Append content to the file.
     * @param to The content to add.
     * @returns This transaction block for chaining.
     */
    public appendContent(to: (string | ((...groups: string[]) => string))): EditTransactionBlock {
        this.to = to;
        return this;
    }

    /**
     * Add search query to be used with {@link EditStrategy.REPLACE_UNSAFE}.
     * @param search The search query that will be used for security.
     * @returns This transaction block for chaining.
     */
    public setSearch(search: string): EditTransactionBlock {
        this.search = search;
        return this;
    }

    /**
     * Create a new change for this transaction.
     * @returns A new transaction block.
     */
    public createBlock(): EditTransactionBlock {
        this.editTransaction.pushTransactionBlock(this);
        return this.editTransaction.createBlock();
    }

    /**
     * Mark this transaction as finished. This function will add the transaction to the queue for edits 
     * and will be processed sequentially.
     * @returns The {@link GenerationToolchain} instance that was used for this transaction.
     */
    public end(): GenerationToolchain {
        this.editTransaction.pushTransactionBlock(this);
        return this.editTransaction.end();
    }

    /**
     * Mark this transaction block as finished.
     * @returns The {@link EditTransaction} that this block belongs to.
     */
    public endBlock(): EditTransaction {
        this.editTransaction.pushTransactionBlock(this);
        return this.editTransaction;
    }
}

/**
 * Instance of the Project Toolchain backend implementation.
 * 
 * This is the entry-point to all code generation and PrismaClient edits, as it provides an unified interface
 * for making changes and creating comments.
 */
export const GenerationToolchainInstance = new GenerationToolchain();