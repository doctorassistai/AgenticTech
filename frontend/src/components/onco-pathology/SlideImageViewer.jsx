// SlideImageViewer.jsx — reserved region for the slide-image viewer.
//
// No whole-slide-image or microscope-camera viewer is connected to this module
// yet. This component holds the place it will occupy and stores the references
// such a viewer needs (viewer link, image type, external reference), so adding
// the real viewer later is a component swap inside this frame rather than a
// re-layout of the Microscopy tab and a data migration.
//
// Deliberately absent: any image analysis. Nothing here scores a slide, counts a
// signal, or measures anything — that needs separately validated instruments.

import React, { useState } from "react";
import { Box, Button, IconButton, TextField, Typography } from "@mui/material";
import {
  AddRounded,
  DeleteOutlineRounded,
  ImageNotSupportedRounded,
  OpenInNewRounded,
} from "@mui/icons-material";
import { C, FONT, FW_LIGHT, FW_NORMAL, inputSx, outlineBtnSx } from "../shared/designTokens";
import { FieldLabel, Sel } from "../shared/FormComponents";
import { IMAGE_TYPE_OPTIONS } from "./shared/microscopyModel";

export default function SlideImageViewer({
  title = "Slide image",
  subtitle = "",
  images = [],
  onAdd,
  onUpdate,
  onRemove,
  disabled = false,
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const active = images[activeIndex] || images[0] || null;

  return (
    <Box sx={{ border: `1px solid ${C.border}`, background: C.white }}>
      {/* The viewer frame. A real WSI / camera viewer renders in this box. */}
      <Box
        sx={{
          position: "relative",
          aspectRatio: "4 / 3",
          minHeight: 220,
          background: C.bgTertiary,
          borderBottom: `1px solid ${C.border}`,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 1,
          px: 3,
          textAlign: "center",
        }}
      >
        <ImageNotSupportedRounded sx={{ fontSize: 28, color: C.textMuted }} />
        <Typography sx={{ fontFamily: FONT, fontSize: 13, fontWeight: FW_NORMAL }}>
          Image viewer not connected
        </Typography>
        <Typography sx={{ fontFamily: FONT, fontSize: 11, color: C.textMuted, maxWidth: 320 }}>
          {title}
          {subtitle ? ` · ${subtitle}` : ""}
        </Typography>
        {active?.viewer_link ? (
          <Button
            sx={{ ...outlineBtnSx, px: 1.5, py: 0.4, mt: 0.5 }}
            component="a"
            href={active.viewer_link}
            target="_blank"
            rel="noreferrer"
          >
            <OpenInNewRounded sx={{ mr: 0.5, fontSize: 15 }} />
            Open recorded image link
          </Button>
        ) : (
          <Typography sx={{ fontFamily: FONT, fontSize: 10, color: C.textMuted, fontStyle: "italic" }}>
            Record a viewer link or image reference below until the viewer is available.
          </Typography>
        )}
      </Box>

      <Box sx={{ p: 1.5 }}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, mb: 1 }}>
          <FieldLabel>Image References</FieldLabel>
          {onAdd && (
            <Button sx={{ ...outlineBtnSx, px: 1.25, py: 0.35 }} onClick={onAdd} disabled={disabled}>
              <AddRounded sx={{ mr: 0.4, fontSize: 15 }} /> Add
            </Button>
          )}
        </Box>

        {images.length === 0 && (
          <Typography sx={{ fontFamily: FONT, fontSize: 11, color: C.textMuted, fontWeight: FW_LIGHT }}>
            No image recorded for this review.
          </Typography>
        )}

        {images.map((image, index) => (
          <Box
            key={image.image_id}
            onClick={() => setActiveIndex(index)}
            sx={{
              border: `1px solid ${index === activeIndex ? C.black : C.border}`,
              p: 1.25,
              mb: 1,
              cursor: "pointer",
              background: index === activeIndex ? C.bgSecondary : C.white,
            }}
          >
            <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 1 }}>
              <Box sx={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1 }}>
                <Sel
                  label="Image Type"
                  options={IMAGE_TYPE_OPTIONS}
                  value={image.image_type}
                  onChange={(value) => onUpdate?.(image.image_id, "image_type", value)}
                />
                <TextField
                  value={image.viewer_link || ""}
                  onChange={(event) => onUpdate?.(image.image_id, "viewer_link", event.target.value)}
                  size="small"
                  fullWidth
                  placeholder="Viewer / WSI link"
                  sx={inputSx}
                />
                <TextField
                  value={image.reference || ""}
                  onChange={(event) => onUpdate?.(image.image_id, "reference", event.target.value)}
                  size="small"
                  fullWidth
                  placeholder="Image or scan reference"
                  sx={inputSx}
                />
                <TextField
                  value={image.note || ""}
                  onChange={(event) => onUpdate?.(image.image_id, "note", event.target.value)}
                  size="small"
                  fullWidth
                  placeholder="What this image shows"
                  sx={inputSx}
                />
              </Box>
              {onRemove && (
                <IconButton
                  size="small"
                  title="Remove image reference"
                  onClick={(event) => { event.stopPropagation(); onRemove(image.image_id); }}
                  sx={{ color: C.textSecond }}
                >
                  <DeleteOutlineRounded fontSize="small" />
                </IconButton>
              )}
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
