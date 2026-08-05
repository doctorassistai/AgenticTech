import { Card, Typography, Box } from "@mui/material";

export function InvestigationNoteCard({ title, data }) {
  if (!data) return null;

  return (
    <Card
      sx={{
        borderRadius: 3,
        p: 3,
        background: "rgba(250,250,255,0.75)",
        backdropFilter: "blur(16px)",
        border: "1px solid rgba(255,255,255,0.5)"
      }}
    >
      <Typography fontSize={16} fontWeight={600} mb={2}>
        {title}
      </Typography>

      <Box sx={{ display: "grid", gap: 1.5 }}>
        {Object.entries(data).map(([key, value]) => (
          <Box
            key={key}
            sx={{
              p: 1.5,
              borderRadius: 2,
              background: "rgba(255,255,255,0.6)",
              border: "1px solid rgba(0,0,0,0.05)"
            }}
          >
            <Typography fontSize={12} fontWeight={600} opacity={0.6}>
              {key}
            </Typography>
            <Typography fontSize={14} fontWeight={500}>
              {String(value)}
            </Typography>
          </Box>
        ))}
      </Box>
    </Card>
  );
}
