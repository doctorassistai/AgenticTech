import React, { useState } from "react";
import { Card, CardContent, CardActions, Typography, Button } from "@mui/material";

/**
 * ToggleCard
 * Props:
 * - title: string
 * - children: ReactNode
 * - defaultOpen: boolean
 */
export function ToggleCard({ title, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Card sx={{ mb: 2 }}>
      <CardActions sx={{ justifyContent: "space-between" }}>
        <Typography variant="h6">{title}</Typography>
        <Button size="small" onClick={() => setOpen(prev => !prev)}>
          {open ? "Hide" : "Show"}
        </Button>
      </CardActions>
      {open && <CardContent>{children}</CardContent>}
    </Card>
  );
}
