export function compressZ80(bytes: any): Uint8Array<ArrayBuffer>;
export function decompressZ80(bytes: any, expectedLength: any): Uint8Array<ArrayBuffer>;
export function writeZ80({ registers, memory, border }?: {
    registers?: {};
    border?: number;
}): Uint8Array<ArrayBuffer>;
export function readZ80(bytes: any): {
    registers: {
        a: number;
        f: number;
        c: number;
        b: number;
        l: number;
        h: number;
        sp: number;
        i: number;
        r: number;
        e: number;
        d: number;
        c_: number;
        b_: number;
        e_: number;
        d_: number;
        l_: number;
        h_: number;
        a_: number;
        f_: number;
        iyl: number;
        iyh: number;
        ixl: number;
        ixh: number;
        iff1: number;
        iff2: number;
        im: number;
    };
    memory: Uint8Array<ArrayBuffer>;
    border: number;
    version: number;
};
