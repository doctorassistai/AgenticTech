import { Box, Typography, Chip, TextField, Button, Paper, IconButton, Fade } from "@mui/material";
import { useRef, useEffect, useState } from "react";
import SendIcon from '@mui/icons-material/Send';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import MedicalInformationIcon from '@mui/icons-material/MedicalInformation';
import PsychologyIcon from '@mui/icons-material/Psychology';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import LightbulbIcon from '@mui/icons-material/Lightbulb';
import MoreVertIcon from '@mui/icons-material/MoreVert';

/* -------------------- AUTO RESIZE -------------------- */
const useAutoResize = (value) => {
    const ref = useRef(null);
    useEffect(() => {
        if (ref.current) {
            ref.current.style.height = "auto";
            ref.current.style.height = ref.current.scrollHeight + "px";
        }
    }, [value]);
    return ref;
};

/* -------------------- SUGGESTIONS -------------------- */
const SUGGESTIONS = [
    { text: "Get patient data", icon: "📋" },
    { text: "Why patient not improving?", icon: "📉" },
    { text: "What went wrong?", icon: "🔍" },
    { text: "Drug dosage optimization", icon: "💊" },
    { text: "What am I missing?", icon: "🤔" },
    { text: "Complete my thought", icon: "🧠" },
    { text: "Smart summarization", icon: "✨" },
];

/* -------------------- STATIC RESPONSE ENGINE -------------------- */
const getStaticReply = (text) => {
    const t = text.toLowerCase();

    if (t.includes("not improving"))
        return `**Possible Causes Analysis**
        
• **Diagnosis Review**: Consider alternative or additional diagnoses
• **Treatment Efficacy**: Current regimen may be suboptimal
• **Patient Compliance**: Assess adherence to prescribed therapy
• **Comorbidities**: Evaluate for new or uncontrolled conditions
• **Drug Resistance**: Consider antimicrobial resistance patterns

**Recommendation**: Review diagnostic criteria and consider additional investigations.`;

    if (t.includes("dose"))
        return `**Dosage Optimization Protocol**
        
**Assessment Parameters:**
• Patient weight & renal/hepatic function
• Current drug interactions (check CYP450)
• Therapeutic drug monitoring levels
• Clinical response metrics
• Adverse effect profile

**Consider:**
• Age-adjusted dosing
• Genetic polymorphisms
• Comorbidity adjustments
• Therapeutic window optimization`;

    if (t.includes("wrong"))
        return `**Clinical Incident Analysis**
        
**Potential Factors:**
• Timeline delays in intervention
• Missed clinical red flags
• Inadequate monitoring parameters
• Documentation inconsistencies
• Communication gaps in care team

**Learning Points:**
• Implement systematic review
• Enhance monitoring protocols
• Improve documentation standards`;

    if (t.includes("summary"))
        return `**Clinical Summary**
        
**Patient Status**: Under active treatment with suboptimal therapeutic response.

**Key Findings:**
• Vital signs within acceptable range
• Laboratory markers show partial response
• Current therapy requires optimization

**Next Steps:**
• Comprehensive diagnostic review
• Treatment regimen reassessment
• Multidisciplinary team consultation`;

    return `**Clinical Thinking Assistant**
    
I've noted your clinical query. I can help you explore:

• **Differential diagnosis** refinement
• **Treatment optimization** strategies
• **Clinical decision** support
• **Evidence-based** recommendations

Please provide more clinical context for personalized guidance.`;
};

/* -------------------- ENHANCED GLASSMORPHISM -------------------- */
const brandGradient = "linear-gradient(135deg, #1b3b9eff 0%, #2b55ffff 30%, #1fe4faff 100%)";
const accentGradient = "linear-gradient(45deg, #3FB6FF 0%, #1CCFC9 100%)";

const enhancedGlass = {
    position: "relative",
    borderRadius: "24px",
    background: "linear-gradient(145deg, rgba(255,255,255,0.25), rgba(255,255,255,0.15))",
    backdropFilter: "blur(20px) saturate(180%)",
    WebkitBackdropFilter: "blur(20px) saturate(180%)",
    boxShadow: `
        0 25px 60px rgba(10, 60, 255, 0.12),
        0 15px 25px rgba(0, 0, 0, 0.08),
        inset 0 1px 0 rgba(255,255,255,0.4),
        inset 0 -1px 0 rgba(0,0,0,0.1)
    `,
    border: "1px solid rgba(255,255,255,0.25)",
    overflow: "hidden",
    "&::before": {
        content: '""',
        position: "absolute",
        inset: 0,
        background: `
            radial-gradient(circle at 10% 10%, rgba(28, 207, 201, 0.15), transparent 40%),
            radial-gradient(circle at 90% 90%, rgba(10, 36, 114, 0.1), transparent 40%),
            linear-gradient(180deg, rgba(255,255,255,0.2), rgba(0,0,0,0.05))
        `,
        pointerEvents: "none",
    },
};

const messageGlass = {
    background: "linear-gradient(135deg, rgba(255,255,255,0.95), rgba(255,255,255,0.85))",
    backdropFilter: "blur(10px)",
    border: "1px solid rgba(255,255,255,0.4)",
    boxShadow: "0 8px 32px rgba(10, 60, 255, 0.08)",
};

const aiMessageGlass = {
    background: "linear-gradient(135deg, rgba(10, 60, 255, 0.08), rgba(28, 207, 201, 0.08))",
    backdropFilter: "blur(10px)",
    border: "1px solid rgba(28, 207, 201, 0.2)",
    boxShadow: "0 8px 32px rgba(28, 207, 201, 0.1)",
};

export default function ClinicalChat({ doctorId, patientId }) {
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState("");
    const [isTyping, setIsTyping] = useState(false);
    const textareaRef = useAutoResize(input);
    const messagesEndRef = useRef(null);

    const sendMessage = (text) => {
        if (!text.trim()) return;

        setMessages((prev) => [
            ...prev,
            { role: "doctor", text, timestamp: new Date() },
        ]);
        setInput("");
        setIsTyping(true);

        // Simulate AI typing delay
        setTimeout(() => {
            setMessages((prev) => [
                ...prev,
                { role: "assistant", text: getStaticReply(text), timestamp: new Date() },
            ]);
            setIsTyping(false);
        }, 800);
    };

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    const formatTime = (date) => {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    return (
        <Box
            sx={{
                p: { xs: 2, md: 4 },
                width: "100%",
                maxWidth: "100%",
                minHeight: "100vh",
                background: "linear-gradient(135deg, #F8FAFF 0%, #F0F7FF 100%)",
            }}
        >
            {/* Main Container */}
            <Fade in={true} timeout={800}>
                <Box sx={{ ...enhancedGlass, p: { xs: 3, md: 4 } }}>
                    {/* Header with Enhanced Design */}
                    <Box sx={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        mb: 4,
                        pb: 3,
                        borderBottom: "1px solid rgba(255,255,255,0.3)",
                        position: "relative",
                    }}>
                        <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
                            <Box>
                                <Typography
                                    variant="h4"
                                    sx={{
                                        background: brandGradient,
                                        WebkitBackgroundClip: "text",
                                        WebkitTextFillColor: "transparent",
                                        fontFamily: '"Open Sans", sans-serif',
                                        fontWeight: 300,
                                        letterSpacing: "-0.5px",
                                        mb: 0.5,
                                    }}
                                >
                                    Clinical ThinkLab
                                </Typography>
                                <Typography
                                    variant="body2"
                                    sx={{
                                        color: "rgba(0,0,0,0.7)",
                                        fontFamily: '"Open Sans", sans-serif',
                                        fontWeight: 400,
                                        fontSize: "14px",
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 1,
                                    }}
                                >
                                    <MedicalInformationIcon sx={{ fontSize: 16, opacity: 0.7 }} />
                                    AI-powered clinical reasoning assistant
                                </Typography>
                            </Box>
                        </Box>

                        <Box sx={{
                            display: "flex",
                            alignItems: "center",
                            gap: 2,
                            background: "rgba(255,255,255,0.3)",
                            borderRadius: "12px",
                            p: 1.5,
                            border: "1px solid rgba(255,255,255,0.2)",
                        }}>
                            <Box>
                                <Typography variant="caption" sx={{
                                    color: "rgba(0,0,0,0.6)",
                                    fontFamily: '"Open Sans", sans-serif',
                                    fontWeight: 500,
                                    fontSize: "11px",
                                    textTransform: "uppercase",
                                    letterSpacing: "0.5px",
                                }}>
                                </Typography>
                                <Typography variant="body2" sx={{
                                    color: "rgba(0,0,0,0.9)",
                                    fontFamily: '"Open Sans", sans-serif',
                                    fontWeight: 600,
                                    fontSize: "13px",
                                }}>
                                </Typography>
                            </Box>
                        </Box>
                    </Box>

                    <Box sx={{ position: "relative" }}>
                        {/* CHAT WINDOW */}
                        <Box
                            sx={{
                                ...messageGlass,
                                p: 3,
                                height: { xs: 400, md: 480 },
                                overflowY: "auto",
                                mb: 3,
                                borderRadius: "20px",
                                position: "relative",
                                "&::-webkit-scrollbar": {
                                    width: "6px",
                                },
                                "&::-webkit-scrollbar-track": {
                                    background: "rgba(0,0,0,0.02)",
                                    borderRadius: "10px",
                                },
                                "&::-webkit-scrollbar-thumb": {
                                    background: "rgba(10, 60, 255, 0.15)",
                                    borderRadius: "10px",
                                },
                            }}
                        >
                            {messages.length === 0 ? (
                                <Box sx={{
                                    display: "flex",
                                    flexDirection: "column",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    height: "100%",
                                    textAlign: "center",
                                    p: 4,
                                }}>
                                    <Box sx={{
                                        width: 100,
                                        height: 100,
                                        mb: 3,
                                        borderRadius: "50%",
                                        background: "linear-gradient(135deg, rgba(10, 60, 255, 0.1), rgba(28, 207, 201, 0.1))",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        border: "2px solid rgba(255,255,255,0.5)",
                                        boxShadow: "0 20px 60px rgba(10, 60, 255, 0.15)",
                                    }}>
                                        <SmartToyIcon sx={{
                                            fontSize: 48,
                                            background: brandGradient,
                                            WebkitBackgroundClip: "text",
                                            WebkitTextFillColor: "transparent",
                                        }} />
                                    </Box>
                                    <Typography variant="h6" sx={{
                                        mb: 1,
                                        color: "rgba(0,0,0,0.9)",
                                        fontFamily: '"Open Sans", sans-serif',
                                        fontWeight: 600,
                                    }}>
                                        Begin Clinical Dialogue
                                    </Typography>
                                    <Typography variant="body2" sx={{
                                        color: "rgba(0,0,0,0.6)",
                                        fontFamily: '"Open Sans", sans-serif',
                                        fontWeight: 300,
                                        maxWidth: "400px",
                                        lineHeight: 1.6,
                                    }}>
                                        Start a conversation with your AI clinical assistant. Ask about diagnosis, treatment options, or get evidence-based recommendations.
                                    </Typography>
                                </Box>
                            ) : (
                                <>
                                    {messages.map((m, i) => (
                                        <Fade in={true} key={i} timeout={500}>
                                            <Box
                                                sx={{
                                                    mb: 3,
                                                    display: "flex",
                                                    flexDirection: "column",
                                                    alignItems: m.role === "doctor" ? "flex-end" : "flex-start",
                                                }}
                                            >
                                                <Box sx={{
                                                    display: "flex",
                                                    alignItems: "center",
                                                    gap: 1,
                                                    mb: 0.5,
                                                    alignSelf: m.role === "doctor" ? "flex-end" : "flex-start",
                                                }}>
                                                    {m.role === "assistant" && (
                                                        <AutoAwesomeIcon sx={{
                                                            fontSize: 14,
                                                            color: "#1CCFC9",
                                                            opacity: 0.8
                                                        }} />
                                                    )}
                                                    <Typography variant="caption" sx={{
                                                        color: m.role === "doctor" ? "#0A3CFF" : "#1CCFC9",
                                                        fontFamily: '"Open Sans", sans-serif',
                                                        fontWeight: 600,
                                                        fontSize: "11px",
                                                        textTransform: "uppercase",
                                                        letterSpacing: "0.5px",
                                                    }}>
                                                        {m.role === "doctor" ? "You" : "Clinical Assistant"}
                                                    </Typography>
                                                    <Typography variant="caption" sx={{
                                                        color: "rgba(0,0,0,0.4)",
                                                        fontFamily: '"Open Sans", sans-serif',
                                                        fontWeight: 400,
                                                        fontSize: "11px",
                                                    }}>
                                                        {formatTime(m.timestamp)}
                                                    </Typography>
                                                </Box>
                                                <Box
                                                    sx={{
                                                        px: 3,
                                                        py: 2.5,
                                                        borderRadius: "18px",
                                                        maxWidth: "85%",
                                                        position: "relative",
                                                        fontFamily: '"Open Sans", sans-serif',
                                                        fontWeight: 400,
                                                        lineHeight: 1.7,
                                                        fontSize: "14.5px",
                                                        whiteSpace: "pre-wrap",
                                                        ...(m.role === "doctor" ? {
                                                            background: "linear-gradient(135deg, #0A3CFF, #3FB6FF)",
                                                            color: "white",
                                                            borderTopRightRadius: "4px",
                                                            boxShadow: "0 8px 32px rgba(10, 60, 255, 0.2)",
                                                        } : {
                                                            ...aiMessageGlass,
                                                            color: "rgba(0,0,0,0.9)",
                                                            borderTopLeftRadius: "4px",
                                                        }),
                                                    }}
                                                >
                                                    {m.text}
                                                    {m.role === "assistant" && (
                                                        <LightbulbIcon sx={{
                                                            position: "absolute",
                                                            bottom: -8,
                                                            left: -8,
                                                            fontSize: 16,
                                                            color: "#1CCFC9",
                                                            opacity: 0.3,
                                                        }} />
                                                    )}
                                                </Box>
                                            </Box>
                                        </Fade>
                                    ))}
                                    {isTyping && (
                                        <Fade in={isTyping}>
                                            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 3 }}>
                                                <Box sx={{
                                                    width: 40,
                                                    height: 40,
                                                    borderRadius: "50%",
                                                    background: "linear-gradient(135deg, rgba(10, 60, 255, 0.1), rgba(28, 207, 201, 0.1))",
                                                    display: "flex",
                                                    alignItems: "center",
                                                    justifyContent: "center",
                                                    border: "1px solid rgba(28, 207, 201, 0.2)",
                                                }}>
                                                    <SmartToyIcon sx={{ fontSize: 18, color: "#1CCFC9" }} />
                                                </Box>
                                                <Box sx={{
                                                    px: 3,
                                                    py: 2.5,
                                                    borderRadius: "18px",
                                                    borderTopLeftRadius: "4px",
                                                    ...aiMessageGlass,
                                                    display: "flex",
                                                    gap: 1,
                                                }}>
                                                    <Box sx={{
                                                        width: 8,
                                                        height: 8,
                                                        borderRadius: "50%",
                                                        background: "#1CCFC9",
                                                        opacity: 0.6,
                                                        animation: "pulse 1.5s infinite",
                                                        "@keyframes pulse": {
                                                            "0%, 100%": { opacity: 0.4 },
                                                            "50%": { opacity: 1 },
                                                        },
                                                    }} />
                                                    <Box sx={{
                                                        width: 8,
                                                        height: 8,
                                                        borderRadius: "50%",
                                                        background: "#1CCFC9",
                                                        opacity: 0.6,
                                                        animation: "pulse 1.5s infinite 0.2s",
                                                    }} />
                                                    <Box sx={{
                                                        width: 8,
                                                        height: 8,
                                                        borderRadius: "50%",
                                                        background: "#1CCFC9",
                                                        opacity: 0.6,
                                                        animation: "pulse 1.5s infinite 0.4s",
                                                    }} />
                                                </Box>
                                            </Box>
                                        </Fade>
                                    )}
                                </>
                            )}
                            <div ref={messagesEndRef} />
                        </Box>

                        {/* SUGGESTIONS PANEL */}
                        <Box sx={{
                            ...messageGlass,
                            p: 2.5,
                            mb: 3,
                            borderRadius: "18px",
                        }}>
                            <Typography
                                variant="subtitle2"
                                sx={{
                                    mb: 2,
                                    color: "rgba(0,0,0,0.8)",
                                    fontFamily: '"Open Sans", sans-serif',
                                    fontWeight: 600,
                                    fontSize: "13px",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 1,
                                }}
                            >
                                <AutoAwesomeIcon sx={{ fontSize: 16, color: "#0A3CFF" }} />
                                Quick Clinical Prompts
                            </Typography>
                            <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap" }}>
                                {SUGGESTIONS.map((s) => (
                                    <Chip
                                        key={s.text}
                                        label={
                                            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                                                <span>{s.icon}</span>
                                                <span>{s.text}</span>
                                            </Box>
                                        }
                                        size="medium"
                                        onClick={() => setInput(s.text)}
                                        sx={{
                                            background: "linear-gradient(135deg, rgba(255,255,255,0.9), rgba(255,255,255,0.7))",
                                            backdropFilter: "blur(10px)",
                                            border: "1px solid rgba(255,255,255,0.4)",
                                            color: "rgba(0,0,0,0.8)",
                                            fontFamily: '"Open Sans", sans-serif',
                                            fontWeight: 500,
                                            fontSize: "13px",
                                            height: "36px",
                                            borderRadius: "12px",
                                            transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
                                            "&:hover": {
                                                background: "linear-gradient(135deg, rgba(10, 60, 255, 0.1), rgba(28, 207, 201, 0.1))",
                                                transform: "translateY(-2px)",
                                                boxShadow: "0 12px 24px rgba(10, 60, 255, 0.15)",
                                                borderColor: "rgba(28, 207, 201, 0.3)",
                                            },
                                            "& .MuiChip-label": {
                                                px: 1.5,
                                            },
                                        }}
                                    />
                                ))}
                            </Box>
                        </Box>

                        {/* INPUT AREA */}
                        <Box
                            sx={{
                                ...messageGlass,
                                p: 2,
                                display: "flex",
                                gap: 2,
                                alignItems: "flex-end",
                                borderRadius: "20px",
                                mb: 3,
                            }}
                        >
                            <TextField
                                fullWidth
                                multiline
                                inputRef={textareaRef}
                                minRows={1}
                                maxRows={4}
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                placeholder="Describe your clinical scenario, ask for differential diagnosis, or seek treatment recommendations..."
                                variant="standard"
                                InputProps={{
                                    disableUnderline: true,
                                    sx: {
                                        fontSize: "14.5px",
                                        fontFamily: '"Open Sans", sans-serif',
                                        fontWeight: 400,
                                        color: "rgba(0,0,0,0.9)",
                                        p: 1.5,
                                        lineHeight: 1.6,
                                        "&::placeholder": {
                                            color: "rgba(0,0,0,0.4)",
                                            fontWeight: 400,
                                        }
                                    }
                                }}
                                sx={{
                                    "& .MuiInputBase-root": {
                                        background: "rgba(255,255,255,0.8)",
                                        borderRadius: "12px",
                                        border: "1px solid rgba(10, 60, 255, 0.1)",
                                        transition: "all 0.3s",
                                        "&:hover": {
                                            borderColor: "#0A3CFF",
                                            boxShadow: "0 0 0 4px rgba(10, 60, 255, 0.05)",
                                        },
                                        "&.Mui-focused": {
                                            borderColor: "#0A3CFF",
                                            boxShadow: "0 0 0 4px rgba(10, 60, 255, 0.1)",
                                        }
                                    }
                                }}
                                onKeyPress={(e) => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault();
                                        sendMessage(input);
                                    }
                                }}
                            />
                            <Button
                                variant="contained"
                                onClick={() => sendMessage(input)}
                                disabled={!input.trim() || isTyping}
                                startIcon={<SendIcon />}
                                sx={{
                                    background: input.trim() ? accentGradient : "rgba(0,0,0,0.1)",
                                    color: "white",
                                    borderRadius: "14px",
                                    px: 4,
                                    py: 1.5,
                                    minWidth: "auto",
                                    fontFamily: '"Open Sans", sans-serif',
                                    fontWeight: 600,
                                    textTransform: "none",
                                    fontSize: "14px",
                                    border: "none",
                                    boxShadow: input.trim() ? "0 8px 32px rgba(28, 207, 201, 0.3)" : "none",
                                    transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
                                    "&:hover": {
                                        transform: "translateY(-2px)",
                                        boxShadow: input.trim() ? "0 16px 40px rgba(28, 207, 201, 0.4)" : "none",
                                    },
                                    "&:disabled": {
                                        background: "rgba(0,0,0,0.05)",
                                        color: "rgba(0,0,0,0.2)",
                                        transform: "none",
                                        boxShadow: "none",
                                    },
                                    "& .MuiButton-startIcon": {
                                        marginRight: 1,
                                    }
                                }}
                            >
                                Analyze
                            </Button>
                        </Box>

                        {/* STATUS BAR */}
                        <Box sx={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            pt: 2,
                            borderTop: "1px solid rgba(255,255,255,0.3)",
                        }}>
                            <Typography
                                variant="caption"
                                sx={{
                                    color: "rgba(0,0,0,0.5)",
                                    fontFamily: '"Open Sans", sans-serif',
                                    fontWeight: 400,
                                    fontSize: "11px",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 1,
                                }}
                            >
                                <Box sx={{
                                    width: 6,
                                    height: 6,
                                    borderRadius: "50%",
                                    background: "#1CCFC9",
                                    animation: "pulse 2s infinite",
                                }} />
                            </Typography>
                            <Typography
                                variant="caption"
                                sx={{
                                    color: "rgba(0,0,0,0.5)",
                                    fontFamily: '"Open Sans", sans-serif',
                                    fontWeight: 400,
                                    fontSize: "11px",
                                }}
                            >
                                {messages.length} clinical exchanges
                            </Typography>
                        </Box>
                    </Box>

                    {/* Add Google Font */}
                    <link
                        href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;500;600;700&display=swap"
                        rel="stylesheet"
                    />
                </Box>
            </Fade>
        </Box>
    );
}