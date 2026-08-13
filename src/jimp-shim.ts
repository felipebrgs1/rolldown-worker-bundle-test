// Composicao do jimp (igual ao index oficial do pacote "jimp", que tem um
// stub vazio no build "browser" e por isso nao pode ser importado direto).
import bmp, { msBmp } from "@jimp/js-bmp";
import gif from "@jimp/js-gif";
import jpeg from "@jimp/js-jpeg";
import png from "@jimp/js-png";
import tiff from "@jimp/js-tiff";
import * as blit from "@jimp/plugin-blit";
import * as blur from "@jimp/plugin-blur";
import * as circle from "@jimp/plugin-circle";
import * as color from "@jimp/plugin-color";
import * as contain from "@jimp/plugin-contain";
import * as cover from "@jimp/plugin-cover";
import * as crop from "@jimp/plugin-crop";
import * as displace from "@jimp/plugin-displace";
import * as dither from "@jimp/plugin-dither";
import * as fisheye from "@jimp/plugin-fisheye";
import * as flip from "@jimp/plugin-flip";
import * as hash from "@jimp/plugin-hash";
import * as mask from "@jimp/plugin-mask";
import * as print from "@jimp/plugin-print";
import * as resize from "@jimp/plugin-resize";
import * as rotate from "@jimp/plugin-rotate";
import * as threshold from "@jimp/plugin-threshold";
import * as quantize from "@jimp/plugin-quantize";
import { createJimp } from "@jimp/core";

export const Jimp = createJimp({
  plugins: [
    blit.methods,
    blur.methods,
    circle.methods,
    color.methods,
    contain.methods,
    cover.methods,
    crop.methods,
    displace.methods,
    dither.methods,
    fisheye.methods,
    flip.methods,
    hash.methods,
    mask.methods,
    print.methods,
    resize.methods,
    rotate.methods,
    threshold.methods,
    quantize.methods,
  ],
  formats: [bmp, msBmp, gif, jpeg, png, tiff],
});
