const WIDTH = 160;
const HEIGHT = 120;

document.addEventListener("DOMContentLoaded", function () {
    const palettemap = document.createElement("img");
    palettemap.src = "./assets/img/arcade-hsp.png";
    const video = document.createElement("video");
    video.width = WIDTH;
    video.height = HEIGHT;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;

    const seriously = new Seriously({
        width: WIDTH,
        height: HEIGHT
    });

    navigator.mediaDevices.getUserMedia({ video: true })
        .then(stream => {
            stream.getTracks().forEach(track => track.stop());
            navigator.mediaDevices.enumerateDevices()
                .then(devices => {
                    const cameras = devices
                        .filter(device => device.kind === "videoinput")
                        // TODO: Add webcam select UI
                        .filter(device => !/^Snap/i.test(device.label))
                        .filter(device => !/^AvStream/i.test(device.label))
                        .filter(device => !/^OBS/i.test(device.label))
                        ;
                    cameras.forEach(camera => console.log(camera.label));
                    const camera = cameras.shift();
                    if (camera) {
                        const constraints = {
                            audio: false,
                            video: {
                                aspectRatio: 4 / 3,
                                deviceId: camera.deviceId,
                                width: { ideal: WIDTH },
                                height: { ideal: HEIGHT }
                            }
                        };
                        navigator.mediaDevices.getUserMedia(constraints)
                            .then(stream => {
                                video.srcObject = stream;
                                video.muted = true;
                                video.play();
                                let source = seriously.source(video);
                                const colorcube = seriously.effect("colorcube");
                                colorcube.source = source;
                                source = colorcube;
                                colorcube.cube = palettemap;
                                const target = seriously.target(canvas);
                                target.source = source;
                                seriously.go();
                            })
                            .catch(e => console.log(e));
                    }
                })
                .catch(e => console.log(e));
        })
        .catch(e => console.log(e));

    const pixelBuffer = new Uint8Array(WIDTH * HEIGHT);
    const webglBuffer = new Uint8Array(WIDTH * HEIGHT * 4);
    const imageBuffer = new Uint8Array(8 + ((WIDTH * HEIGHT) >> 1));

    function draw() {
        if (video.paused || video.ended) return false;
        const sim = document.getElementById('simframe');
        if (sim) {
            context.readPixels(0, 0, WIDTH, HEIGHT, WebGLRenderingContext.RGBA, WebGLRenderingContext.UNSIGNED_BYTE, webglBuffer);

            for (let index = 0, j = 0; j < HEIGHT; ++j) {
                const row = HEIGHT - j - 1;
                for (let i = 0; i < WIDTH; ++i, ++index) {
                    const col = i;
                    const ipix = row * WIDTH + col;
                    const ibuf = index * 4;
                    const r = webglBuffer[ibuf + 0];
                    const g = webglBuffer[ibuf + 1];
                    const b = webglBuffer[ibuf + 2];
                    const a = webglBuffer[ibuf + 3];
                    if (a != 0xff) {
                        pixelBuffer[ipix] = 0;
                    } else {
                        // We should not need a color map here, but the cubemap
                        // filter isn't mapping exactly to the palette.
                        // Needs investigation. This should all work on the GPU.
                        const value = rgb(r, g, b);
                        if (palette[value]) {
                            pixelBuffer[ipix] = palette[value].index;
                        } else if (colormap[value]) {
                            pixelBuffer[ipix] = colormap[value].index;
                        } else {
                            pixelBuffer[ipix] = updateColorMap(r, g, b);
                        }
                    }
                }
            }

            packImageFromBuffer(pixelBuffer, imageBuffer);

            sim.contentWindow.postMessage({
                type: 'messagepacket',
                channel: 'webcam',
                data: imageBuffer
            }, "*");
        }
    }

    // draw at 50fps
    setInterval(draw, 20);
});

function packImageFromBuffer(buf, r) {
    r[0] = 0x87;    // Magic number for "Image"
    r[1] = 4;       // BPP
    r[2] = WIDTH & 0xff;
    r[3] = WIDTH >> 8;
    r[4] = HEIGHT & 0xff;
    r[5] = HEIGHT >> 8;

    for (let dstP = 8, i = 0; i < WIDTH; ++i) {
        for (let j = 0; j < HEIGHT; j += 2, ++dstP) {
            const p = j * WIDTH + i;
            r[dstP] = (buf[p + WIDTH] << 4) | (buf[p] & 0x0f);
        }
    }
}

//===================================================================
// Software palette mapping -- to be removed once it's working on GPU

function rgb(r, g, b) {
    return ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff);
}
const palette = {
};

function addPaletteEntry(r, g, b, i) {
    palette[rgb(r, g, b)] = {
        r, g, b,
        index: i
    };
}

addPaletteEntry(0xff, 0xff, 0xff, 1);
addPaletteEntry(0xff, 0x21, 0x21, 2);
addPaletteEntry(0xff, 0x93, 0xc4, 3);
addPaletteEntry(0xff, 0x81, 0x35, 4);
addPaletteEntry(0xff, 0xf6, 0x09, 5);
addPaletteEntry(0x24, 0x9c, 0xa3, 6);
addPaletteEntry(0x78, 0xdc, 0x52, 7);
addPaletteEntry(0x00, 0x3f, 0xad, 8);
addPaletteEntry(0x87, 0xf2, 0xff, 9);
addPaletteEntry(0x8e, 0x2e, 0xc4, 10);
addPaletteEntry(0xa4, 0x83, 0x9f, 11);
addPaletteEntry(0x5c, 0x40, 0x6c, 12);
addPaletteEntry(0xe5, 0xcd, 0xc4, 13);
addPaletteEntry(0x91, 0x46, 0x3d, 14);
addPaletteEntry(0x00, 0x00, 0x00, 15);

const colormap = {
};

// Rec. 601 luma coefficients
// https://en.wikipedia.org/wiki/Luma_(video)
const RCOF = 0.299;
const GCOF = 0.587;
const BCOF = 0.114;

function updateColorMap(r, g, b) {
    // If a pixel color doesn't exist in the palette, find the nearest
    // matching color using the same algorithm used for generating the
    // cubemap.
    let min = Number.MAX_SAFE_INTEGER;
    let k;
    Object.keys(palette).forEach(key => {
        const color = palette[key];
        const rdiff = color.r - r;
        const gdiff = color.g - g;
        const bdiff = color.b - b;
        const hsp = RCOF * rdiff * rdiff + GCOF * gdiff * gdiff + BCOF * bdiff * bdiff;
        if (hsp < min) {
            min = hsp;
            k = color;
        }
    });
    if (k) {
        const c = rgb(r, g, b);
        colormap[c] = k;
        return k.index;
    }
    return 0;
}