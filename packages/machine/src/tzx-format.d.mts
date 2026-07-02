export function parseTzx(bytes: any): {
    version: {
        major: number;
        minor: number;
    };
    blocks: any[];
};
export function serializeTzx(tzx: any): Uint8Array<ArrayBuffer>;
export const TZX_SIGNATURE: "ZXTape!";
export namespace TZX_VERSION {
    let major: number;
    let minor: number;
}
