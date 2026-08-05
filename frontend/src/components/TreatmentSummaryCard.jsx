import { Card, Typography, Box, Divider } from "@mui/material";

export function TreatmentSummaryCard({ title, data }) {
  if (!data) return null;

  return (
    <Card
      sx={{
        borderRadius: 3,
        p: 3,
        background: "rgba(255,255,255,0.78)",
        backdropFilter: "blur(18px)",
        border: "1px solid rgba(255,255,255,0.6)",
        boxShadow: "0 8px 24px rgba(0,0,0,0.04)"
      }}
    >
      <Typography fontSize={16} fontWeight={600} mb={2}>
        {title}
      </Typography>

      <Box sx={{ display: "grid", gap: 2 }}>
        {Object.entries(data).map(([key, value]) => (
          <Box key={key}>
            <Typography
              fontSize={12}
              fontWeight={600}
              opacity={0.6}
              letterSpacing="0.04em"
            >
              {key}
            </Typography>

            <Typography fontSize={14} lineHeight={1.7} mt={0.3}>
              {String(value)}
            </Typography>

            <Divider sx={{ mt: 1.5, opacity: 0.4 }} />
          </Box>
        ))}
      </Box>
    </Card>
  );
}
