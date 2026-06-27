import fs from 'node:fs';
import path from 'node:path';

import { SpectrumDisplay } from '../../src/spectrum/display.js';
import { SpectrumMemory } from '../../src/spectrum/memory.js';
import { SpectrumULA } from '../../src/spectrum/ula.js';
import { MemoryInterface } from '../../src/interfaces/memory-interface.js';
import {
    VIDEO_PROFILE_48K_PAL,
    bitmapByteBeamTstate,
    displayPixelToFrameTstate,
    floatingBusAddressForTstate,
} from '../../src/spectrum/video-timing.js';

const fixturesDir = path.join(process.cwd(), 'tests', 'fixtures', 'video-fidelity');

function rgbAt(display, x, y) {
    const offset = (y * display.totalWidth + x) * 4;
    return Array.from(display.displayBuffer.slice(offset, offset + 3));
}

describe('48K PAL video fidelity primitives', () => {
    it('records a stable border timeline while keeping scanline colors compatible', () => {
        const ula = new SpectrumULA();
        let tstate = 0;
        ula.setFrameTimingProvider(() => tstate);
        ula.beginFrameTrace();

        tstate = 12;
        ula.writePort(0xfe, 0x02);
        tstate = 24;
        ula.writePort(0xfe, 0x04);

        expect(ula.getBorderTimeline()).toEqual([
            { tstate: 0, color: 1 },
            { tstate: 12, color: 2 },
            { tstate: 24, color: 4 },
        ]);
        expect(ula.getScanlineBorderColors()).toBeInstanceOf(Uint8Array);
        expect(ula.getScanlineBorderColors().length).toBe(312);
        expect(ula.getScanlineBorderColors()[0]).toBe(4);
    });

    it('paints accurateVideo border changes with horizontal resolution', () => {
        const display = new SpectrumDisplay();
        const changeAt = displayPixelToFrameTstate(100, 0, VIDEO_PROFILE_48K_PAL);

        display.renderAccurate(
            {
                screenMemory: new Uint8Array(6144),
                attributeMemory: new Uint8Array(768),
                writes: [],
            },
            [
                { tstate: 0, color: 1 },
                { tstate: changeAt, color: 2 },
            ]
        );

        expect(rgbAt(display, 99, 0)).toEqual([0x00, 0x00, 0xd7]);
        expect(rgbAt(display, 100, 0)).toEqual([0xd7, 0x00, 0x00]);
    });

    it('renders bitmap writes before the beam and ignores writes after the beam', () => {
        const display = new SpectrumDisplay();
        const screenMemory = new Uint8Array(6144);
        const attributeMemory = new Uint8Array(768);
        attributeMemory[0] = 0x07;
        const beamTstate = bitmapByteBeamTstate(0, 0, VIDEO_PROFILE_48K_PAL);

        display.renderAccurate({
            screenMemory,
            attributeMemory,
            writes: [{ tstate: beamTstate - 1, address: 0x4000, value: 0xff }],
        });
        expect(rgbAt(display, display.borderLeft, display.borderTop)).toEqual([0xd7, 0xd7, 0xd7]);

        display.renderAccurate({
            screenMemory,
            attributeMemory,
            writes: [{ tstate: beamTstate + 1, address: 0x4000, value: 0xff }],
        });
        expect(rgbAt(display, display.borderLeft, display.borderTop)).toEqual([0x00, 0x00, 0x00]);
    });

    it('renders thousands of temporal writes without per-pixel write scans', () => {
        const display = new SpectrumDisplay();
        const screenMemory = new Uint8Array(6144);
        const attributeMemory = new Uint8Array(768);
        attributeMemory.fill(0x07);
        const writes = [];

        for (let i = 0; i < 12000; i++) {
            writes.push({
                tstate: i * 4,
                address: 0x4000 + (i % 0x1800),
                value: i & 0xff,
            });
        }

        const started = process.hrtime.bigint();
        display.renderAccurate({ screenMemory, attributeMemory, writes });
        const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;

        expect(elapsedMs).toBeLessThan(120);
    });

    it('exposes the ULA byte on the floating bus during useful display windows', () => {
        const memory = new SpectrumMemory();
        const ula = new SpectrumULA();
        let tstate = 64 * 224 + 48;
        memory.write(0x4000, 0xab);
        memory.write(0x5800, 0xcd);
        ula.setFrameTimingProvider(() => tstate);
        ula.setFloatingBusProvider((ts) => memory.readFloatingBus(ts));

        expect(floatingBusAddressForTstate(tstate)).toBe(0x4000);
        expect(ula.readPort(0xffff)).toBe(0xab);

        tstate += 1;
        expect(floatingBusAddressForTstate(tstate)).toBe(0x5800);
        expect(ula.readPort(0xffff)).toBe(0xcd);

        tstate = 0;
        expect(ula.readPort(0xffff)).toBe(0xff);
    });

    it('uses the 6,5,4,3,2,1,0,0 contention pattern for contended RAM and ports', () => {
        const memory = new SpectrumMemory();
        const ula = new SpectrumULA();
        memory.setContentionEnabled(true);
        ula.setContentionEnabled(true);

        const base = 64 * 224 + 48;
        const memoryDelays = Array.from({ length: 8 }, (_, i) => memory.getContentionDelay(0x4000, base + i));
        const portDelays = Array.from({ length: 8 }, (_, i) => ula.getPortContentionDelay(0x00fe, base + i));

        expect(memoryDelays).toEqual([6, 5, 4, 3, 2, 1, 0, 0]);
        expect(portDelays).toEqual([6, 5, 4, 3, 2, 1, 0, 0]);
        expect(memory.getContentionDelay(0x8000, base)).toBe(0);
        expect(ula.getPortContentionDelay(0xffff, base)).toBe(0);
    });

    it('applies contention to each byte of word memory accesses', () => {
        const calls = [];
        const ram = new Uint8Array(0x10000);
        ram[0x4000] = 0x34;
        ram[0x4001] = 0x12;
        const memory = new MemoryInterface({
            read: (addr) => ram[addr & 0xffff],
            write: (addr, value) => {
                ram[addr & 0xffff] = value & 0xff;
            },
            getContentionDelay: (addr, extraCycles) => {
                calls.push({ addr, extraCycles });
                return 1;
            },
        });

        expect(memory.readWord(0x4000)).toBe(0x1234);
        expect(memory.consumeExtraCycles()).toBe(2);
        expect(calls).toEqual([
            { addr: 0x4000, extraCycles: 0 },
            { addr: 0x4001, extraCycles: 1 },
        ]);

        calls.length = 0;
        memory.writeWord(0x4000, 0xabcd);
        expect(memory.consumeExtraCycles()).toBe(2);
        expect(ram[0x4000]).toBe(0xcd);
        expect(ram[0x4001]).toBe(0xab);
        expect(calls).toEqual([
            { addr: 0x4000, extraCycles: 0 },
            { addr: 0x4001, extraCycles: 1 },
        ]);
    });

    it('keeps executable video-fidelity corpus fixtures in sync with timing helpers', () => {
        const events = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'events.json'), 'utf8'));
        const reads = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'reads.json'), 'utf8'));

        expect(events.profile).toBe('48k-pal');
        expect(events.borderTimeline[1].tstate).toBe(displayPixelToFrameTstate(100, 0, VIDEO_PROFILE_48K_PAL));
        expect(reads.floatingBus[0].address).toBe(floatingBusAddressForTstate(reads.floatingBus[0].tstate));
    });
});
