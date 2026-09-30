import React, { useMemo } from "react";
import { Box, Typography } from "@mui/material";

import { C, FONT } from "../../shared/designTokens";

// Each pattern is the alternating bar/space module width for one Code 128 symbol.
const CODE128_PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
];

const START_CODE_B = 104;
const STOP_CODE = 106;
const QUIET_ZONE_MODULES = 10;

const encodeCode128B = (value) => {
  const codes = Array.from(value).map((character) => {
    const codePoint = character.charCodeAt(0);
    return codePoint >= 32 && codePoint <= 126 ? codePoint - 32 : null;
  });
  if (codes.some((code) => code === null)) return null;

  const checksum = codes.reduce(
    (total, code, index) => total + code * (index + 1),
    START_CODE_B
  ) % 103;
  const patterns = [START_CODE_B, ...codes, checksum, STOP_CODE]
    .map((code) => CODE128_PATTERNS[code]);

  let x = QUIET_ZONE_MODULES;
  const bars = [];
  patterns.forEach((pattern) => {
    Array.from(pattern).forEach((widthText, index) => {
      const width = Number(widthText);
      if (index % 2 === 0) bars.push({ x, width });
      x += width;
    });
  });

  return {
    bars,
    width: x + QUIET_ZONE_MODULES,
  };
};

const barcodePayload = (value, accessionId) => {
  const rawValue = String(value || "");
  const accession = String(accessionId || "");
  const match = accession.match(/^TMH-(\d{4})-(\d{1,6})$/);
  if (!rawValue || !match) return rawValue;
  const caseCode = `${match[1].slice(-2)}${match[2].padStart(6, "0")}`;
  return `${caseCode}:${rawValue}`;
};

const hasCaseScope = (accessionId) => /^TMH-(\d{4})-(\d{1,6})$/.test(String(accessionId || ""));

export default function Code128Barcode({ value, accessionId }) {
  const payload = useMemo(() => barcodePayload(value, accessionId), [value, accessionId]);
  const encoded = useMemo(() => encodeCode128B(payload), [payload]);
  if (!value) return null;
  if (!hasCaseScope(accessionId)) {
    return (
      <Typography sx={{ fontFamily: FONT, fontSize: 11, color: C.textMuted }}>
        Save the case to generate its case-bound barcode.
      </Typography>
    );
  }

  if (!encoded) {
    return (
      <Typography sx={{ fontFamily: FONT, fontSize: 11, color: C.textMuted }}>
        Barcode unavailable for this identifier.
      </Typography>
    );
  }

  return (
    <Box sx={{ border: `1px solid ${C.border}`, background: C.white, p: 1.25, overflowX: "auto" }}>
      <svg
        aria-label={`Code 128 barcode for ${payload}`}
        role="img"
        shapeRendering="crispEdges"
        viewBox={`0 0 ${encoded.width} 52`}
        width={Math.max(encoded.width * 2, 280)}
        height="62"
        style={{ display: "block", margin: "0 auto", maxWidth: "none" }}
      >
        <rect width={encoded.width} height="52" fill="#fff" />
        {encoded.bars.map((bar, index) => (
          <rect key={`${bar.x}-${index}`} x={bar.x} y="2" width={bar.width} height="48" fill="#000" />
        ))}
      </svg>
      <Typography sx={{ fontFamily: FONT, fontSize: 10, color: C.textSecond, textAlign: "center", mt: 0.5, wordBreak: "break-all" }}>
        {payload}
      </Typography>
    </Box>
  );
}
