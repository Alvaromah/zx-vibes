export function tapChecksum(flag: any, data: any): number;
export function parseTap(bytes: any): {
    flag: number;
    data: Uint8Array<ArrayBuffer>;
    checksum: number;
}[];
export function serializeTap(blocks: any): Uint8Array<ArrayBuffer>;
