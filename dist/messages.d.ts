/**Premade message for the general help menu. */
export declare const showIntro: () => void;
/**Little utility to create nice messages. */
export default class MessageBuilder {
    text: string;
    constructor();
    withHeader(): this;
    withTitle(title: string): this;
    withSection(title: string, items: string[]): this;
    withNewLine(): this;
    show(): void;
}
export declare const prismaCLITag: string;
export declare const errorTag: string;
export declare const warningTag: string;
export declare const conflictTag: string;
export declare const successTag: string;
export declare const experimentalTag: string;
