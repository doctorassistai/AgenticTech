import { Card, Typography, Box } from "@mui/material";

export function ClinicalNoteCard({ title, data }) {
  if (!data) return null;

  return (
    <Card
      sx={{
        borderRadius: 3,
        p: 3,
        background: "rgba(255,255,255,0.75)",
        backdropFilter: "blur(16px)",
        border: "1px solid rgba(255,255,255,0.5)"
      }}
    >
      <Typography fontSize={16} fontWeight={600} mb={2}>
        {title}
      </Typography>

      {Object.entries(data).map(([key, value]) => (
        <Box key={key} sx={{ mb: 1.5 }}>
          <Typography fontSize={12} fontWeight={600} opacity={0.6}>
            {key}
          </Typography>
          <Typography fontSize={14} lineHeight={1.6}>
            {String(value)}
          </Typography>
        </Box>
      ))}
    </Card>
  );
}
