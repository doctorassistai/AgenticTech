import React, { useMemo } from "react";
import {
  Card,
  CardHeader,
  CardContent,
  Typography
} from "@mui/material";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from "recharts";

const brandGradient =
  "linear-gradient(135deg, #1ccfc9 0%, #3fb6ff 50%, #2b5cff 100%)";

export default function ReusableChartCard({ title, data, xKey }) {
  if (!Array.isArray(data) || data.length === 0) return null;

  const firstRow = data[0];

  /* 🔑 Resolve X-axis key */
  const resolvedXKey = useMemo(() => {
    if (xKey && xKey in firstRow) return xKey;
    const detected = Object.keys(firstRow).find(
      key => typeof firstRow[key] !== "number"
    );
    return detected || "__index__";
  }, [xKey, firstRow]);

  /* 🔑 Normalize data */
  const chartData = useMemo(() => {
    if (resolvedXKey !== "__index__") return data;
    return data.map((item, index) => ({
      ...item,
      __index__: index + 1
    }));
  }, [data, resolvedXKey]);

  /* 🔑 Detect numeric Y-axis keys */
  const lines = useMemo(() => {
    return Object.keys(firstRow)
      .filter(key => typeof firstRow[key] === "number")
      .map((key, index) => ({
        key,
        color: ["#1ccfc9", "#3fb6ff", "#2b5cff", "#8b5cf6"][index % 4]
      }));
  }, [firstRow]);

  if (lines.length === 0) {
    return (
      <Card sx={glassCard}>
        {title && <CardHeader title={title} sx={headerStyle} />}
        <CardContent>
          <Typography sx={{ color: "#1a1a1a", opacity: 0.6, fontSize: "13px", fontFamily: "'Inter', sans-serif" }}>
            No numeric values found
          </Typography>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card sx={glassCard}>
      {title && (
        <CardHeader
          title={
            <Typography sx={headerTitleText}>
              {title}
            </Typography>
          }
          sx={{ pb: 0 }}
        />
      )}

      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid
              vertical={false}
              stroke="rgba(0,0,0,0.04)"
              strokeDasharray="3 3"
            />

            <XAxis
              dataKey={resolvedXKey}
              axisLine={false}
              tickLine={false}
              stroke="#1a1a1a"
              tick={{ fill: "#1a1a1a", fontSize: 11, fontWeight: 500, fontFamily: "'Inter', sans-serif", opacity: 0.5 }}
              dy={10}
            />

            <YAxis
              axisLine={false}
              tickLine={false}
              stroke="#1a1a1a"
              tick={{ fill: "#1a1a1a", fontSize: 11, fontWeight: 500, fontFamily: "'Inter', sans-serif", opacity: 0.5 }}
            />

            <Tooltip
              cursor={{ stroke: 'rgba(0,0,0,0.05)', strokeWidth: 2 }}
              contentStyle={{
                background: "rgba(255, 255, 255, 0.8)",
                backdropFilter: "blur(12px)",
                border: "1px solid rgba(255, 255, 255, 0.5)",
                borderRadius: "12px",
                boxShadow: "0 8px 16px rgba(0,0,0,0.05)",
                fontFamily: "'Inter', sans-serif",
                fontSize: "12px",
                fontWeight: 600
              }}
              itemStyle={{ padding: '2px 0' }}
            />

            <Legend
              verticalAlign="top"
              align="right"
              iconType="circle"
              wrapperStyle={{
                paddingBottom: "20px",
                fontSize: "11px",
                fontWeight: 600,
                fontFamily: "'Inter', sans-serif",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                opacity: 0.7
              }}
            />

            {lines.map(line => (
              <Line
                key={line.key}
                type="monotone"
                dataKey={line.key}
                stroke={line.color}
                strokeWidth={3}
                dot={false}
                activeDot={{ r: 6, strokeWidth: 0 }}
                name={line.key}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

/* ================= REFINED STYLES ================= */

const glassCard = {
  mb: 3,
  borderRadius: "24px",
  background: "linear-gradient(180deg, rgba(255, 255, 255, 0.7), rgba(255, 255, 255, 0.3))",
  backdropFilter: "blur(20px) saturate(160%)",
  WebkitBackdropFilter: "blur(20px) saturate(160%)",
  border: "1px solid rgba(255, 255, 255, 0.4)",
  boxShadow: "0 8px 32px rgba(0, 0, 0, 0.04)",
  fontFamily: "'Inter', sans-serif",
};

const headerTitleText = {
  fontSize: "14px",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  fontFamily: "'Inter', sans-serif",
  background: brandGradient,
  WebkitBackgroundClip: "text",
  WebkitTextFillColor: "transparent",
};