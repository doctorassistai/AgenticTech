import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  MenuItem,
  Select,
  Snackbar,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";

import {
  AddRounded,
  DeleteOutlineRounded,
  DownloadRounded,
  SaveRounded,
  CloseRounded,
  PsychologyRounded,
  RefreshRounded,
} from "@mui/icons-material";

/* =========================================================
   API
========================================================= */

const API_BASE_URL = (import.meta.env.VITE_BACKEND_URL || "").replace(
  /\/$/,
  ""
);

const PRETREATMENT_MOUNT =
  "hms/users/ai-legacy/pre-treatment-assessment-new";

const buildDoctorSkillsUrl = (doctorId) =>
  `${API_BASE_URL}/${PRETREATMENT_MOUNT}/skills/doctor/${encodeURIComponent(
    doctorId
  )}`;

const buildCustomizeUrl = () =>
  `${API_BASE_URL}/${PRETREATMENT_MOUNT}/skills/customize`;

/* =========================================================
   UI
========================================================= */

const FONT = '"Open Sans", sans-serif';

const COLORS = {
  white: "#ffffff",
  paper: "#fafafa",
  fog: "#f3f3f3",
  mist: "#e8e8e8",
  border: "#d5d5d5",
  ink: "#111111",
  charcoal: "#333333",
  smoke: "#5f5f5f",
  ash: "#858585",
};

/*
 * These fields belong to the backend/system and are therefore
 * not exposed as editable clinical content.
 *
 * This is intentionally limited to technical metadata.
 * No clinical field names or specialty-specific fields are used.
 */
const SYSTEM_FIELDS = new Set([
  "_id",
  "skill_id",
  "type",
  "catalog_source",
  "version",
  "status",
  "customized",
  "enabled",
]);

/* =========================================================
   GENERIC HELPERS
========================================================= */

const safeArray = (value) => (Array.isArray(value) ? value : []);

const clone = (value) => {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
};

const isPlainObject = (value) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value);

const humanize = (value) =>
  String(value || "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());

const valueToText = (value) => {
  if (value === null || value === undefined) return "";

  if (typeof value === "string") return value;

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const convertEditedPrimitive = (originalValue, nextText) => {
  if (typeof originalValue === "number") {
    if (nextText.trim() === "") return "";

    const parsed = Number(nextText);
    return Number.isNaN(parsed) ? nextText : parsed;
  }

  if (typeof originalValue === "boolean") {
    if (nextText.trim() === "") return "";

    if (nextText.toLowerCase() === "true") return true;
    if (nextText.toLowerCase() === "false") return false;

    return nextText;
  }

  return nextText;
};

/* =========================================================
   MARKDOWN EXPORT
========================================================= */

const toMarkdownValue = (value, depth = 0) => {
  const prefix = "  ".repeat(depth);

  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (isPlainObject(item)) {
          return `${prefix}-\n${toMarkdownValue(item, depth + 1)}`;
        }

        return `${prefix}- ${String(item ?? "")}`;
      })
      .join("\n");
  }

  if (isPlainObject(value)) {
    return Object.entries(value)
      .filter(([key]) => !["customized", "enabled"].includes(key))
      .map(([key, val]) => {
        if (val && typeof val === "object") {
          return `${prefix}### ${humanize(key)}\n\n${toMarkdownValue(
            val,
            depth + 1
          )}`;
        }

        return `${prefix}- **${humanize(key)}:** ${String(val ?? "")}`;
      })
      .join("\n\n");
  }

  return `${prefix}${String(value ?? "")}`;
};

const skillToMarkdown = (skill) => {
  const title =
    skill?.name ||
    humanize(skill?.skill_id) ||
    "Clinical Expertise Skill";

  const lines = [
    `# ${title}`,
    "",
    `- **Type:** ${humanize(
      skill?.type || "Clinical Expertise"
    )}`,
    `- **Status:** ${
      skill?.enabled === false ? "Disabled" : "Enabled"
    }`,
    "",
  ];

  Object.entries(skill || {}).forEach(([key, value]) => {
    if (
      [
        "_id",
        "skill_id",
        "name",
        "type",
        "status",
        "customized",
        "enabled",
        "catalog_source",
        "version",
      ].includes(key)
    ) {
      return;
    }

    lines.push(`## ${humanize(key)}`);
    lines.push("");
    lines.push(toMarkdownValue(value));
    lines.push("");
  });

  return lines.join("\n").trim() + "\n";
};

const downloadText = (filename, text) => {
  const blob = new Blob([text], {
    type: "text/markdown;charset=utf-8",
  });

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = filename;

  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  URL.revokeObjectURL(url);
};

/* =========================================================
   SMALL REUSABLE UI HELPERS
========================================================= */

/*
 * A section heading is deliberately only a heading + divider.
 * There is no nested card/box around clinical data.
 */
const EditorSectionHeading = ({ label, action }) => (
  <Box
    sx={{
      pt: 1.5,
      pb: 0.75,
      mb: 1,
    }}
  >
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 1,
      }}
    >
      <Typography
        sx={{
          fontFamily: FONT,
          fontSize: 12,
          fontWeight: 700,
          color: COLORS.ink,
        }}
      >
        {label}
      </Typography>

      {action}
    </Box>

    <Divider sx={{ mt: 0.75 }} />
  </Box>
);

const RemoveButton = ({ label, onClick }) => (
  <Tooltip title={`Remove ${label}`}>
    <IconButton
      size="small"
      onClick={onClick}
      sx={{
        color: COLORS.ash,
        flexShrink: 0,
        "&:hover": {
          color: COLORS.ink,
          background: COLORS.fog,
        },
      }}
    >
      <DeleteOutlineRounded sx={{ fontSize: 17 }} />
    </IconButton>
  </Tooltip>
);

const PrimitiveField = ({
  label,
  value,
  onChange,
  removable = false,
  onRemove,
}) => (
  <Box
    sx={{
      display: "grid",
      gridTemplateColumns: {
        xs: "1fr",
        sm: removable ? "minmax(150px, 0.35fr) minmax(0, 1fr) auto" : "minmax(150px, 0.35fr) minmax(0, 1fr)",
      },
      alignItems: "center",
      gap: 1,
      py: 0.75,
      borderBottom: `1px solid ${COLORS.mist}`,
    }}
  >
    <Typography
      sx={{
        fontFamily: FONT,
        fontSize: 11,
        fontWeight: 600,
        color: COLORS.smoke,
      }}
    >
      {label}
    </Typography>

    <TextField
      fullWidth
      size="small"
      multiline
      minRows={value ? 1 : 1}
      value={valueToText(value)}
      onChange={(event) =>
        onChange(
          convertEditedPrimitive(
            value,
            event.target.value
          )
        )
      }
      sx={{
        "& .MuiOutlinedInput-root": {
          background: COLORS.white,
        },
        "& .MuiInputBase-input": {
          fontFamily: FONT,
          fontSize: 11,
          lineHeight: 1.5,
        },
      }}
    />

    {removable && onRemove ? (
      <RemoveButton label={label} onClick={onRemove} />
    ) : null}
  </Box>
);

/* =========================================================
   DYNAMIC ARRAY EDITOR
========================================================= */

const EditableArray = ({
  label,
  value,
  onChange,
  nested = false,
}) => {
  const items = safeArray(value);

  const firstObjectItem =
    items.length > 0 && isPlainObject(items[0]);

  const updateItem = (index, next) => {
    const nextItems = [...items];
    nextItems[index] = next;
    onChange(nextItems);
  };

  const removeItem = (index) => {
    onChange(items.filter((_, itemIndex) => itemIndex !== index));
  };

  const addItem = () => {
    /*
     * The editor derives the new item's shape from the existing
     * data. It does not contain specialty-specific assumptions.
     */
    if (firstObjectItem) {
      onChange([...items, {}]);
      return;
    }

    onChange([...items, ""]);
  };

  return (
    <Box sx={{ mb: 2 }}>
      <EditorSectionHeading
        label={label}
        action={
          <Button
            size="small"
            startIcon={<AddRounded />}
            onClick={addItem}
            sx={{
              fontFamily: FONT,
              fontSize: 10.5,
              textTransform: "none",
              color: COLORS.ink,
              minWidth: 0,
            }}
          >
            Add
          </Button>
        }
      />

      {items.length === 0 ? (
        <Box
          sx={{
            py: 1,
            px: 0.5,
          }}
        >
          <Typography
            sx={{
              fontFamily: FONT,
              fontSize: 10.5,
              color: COLORS.ash,
            }}
          >
            Nothing added yet.
          </Typography>
        </Box>
      ) : (
        <Stack spacing={0}>
          {items.map((item, index) => {
            const objectItem = isPlainObject(item);

            if (objectItem) {
              return (
                <Box
                  key={`${label}-${index}`}
                  sx={{
                    py: 0.75,
                    borderBottom: `1px solid ${COLORS.mist}`,
                  }}
                >
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 1,
                      mb: 0.25,
                    }}
                  >
                    <Typography
                      sx={{
                        fontFamily: FONT,
                        fontSize: 10,
                        fontWeight: 700,
                        color: COLORS.ash,
                      }}
                    >
                      {label} {index + 1}
                    </Typography>

                    <RemoveButton
                      label={`${label} ${index + 1}`}
                      onClick={() => removeItem(index)}
                    />
                  </Box>

                  <EditableObject
                    value={item}
                    onChange={(next) =>
                      updateItem(index, next)
                    }
                    nested
                  />
                </Box>
              );
            }

            return (
              <Box
                key={`${label}-${index}`}
                sx={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto",
                  alignItems: "center",
                  gap: 0.75,
                  py: 0.5,
                  borderBottom: `1px solid ${COLORS.mist}`,
                }}
              >
                <TextField
                  fullWidth
                  size="small"
                  value={valueToText(item)}
                  onChange={(event) =>
                    updateItem(
                      index,
                      convertEditedPrimitive(
                        item,
                        event.target.value
                      )
                    )
                  }
                  placeholder={`${label} ${index + 1}`}
                  sx={{
                    "& .MuiOutlinedInput-root": {
                      background: COLORS.white,
                    },
                    "& .MuiInputBase-input": {
                      fontFamily: FONT,
                      fontSize: 11,
                    },
                  }}
                />

                <RemoveButton
                  label={`${label} ${index + 1}`}
                  onClick={() => removeItem(index)}
                />
              </Box>
            );
          })}
        </Stack>
      )}
    </Box>
  );
};

/* =========================================================
   DYNAMIC RECURSIVE OBJECT EDITOR
========================================================= */

const EditableObject = ({
  value,
  onChange,
  nested = false,
}) => {
  const objectValue = isPlainObject(value) ? value : {};

  const updateField = (key, nextValue) => {
    onChange({
      ...objectValue,
      [key]: nextValue,
    });
  };

  const removeField = (key) => {
    const next = { ...objectValue };
    delete next[key];
    onChange(next);
  };

  const entries = Object.entries(objectValue);

  if (entries.length === 0) {
    return (
      <Box sx={{ py: 0.75 }}>
        <Typography
          sx={{
            fontFamily: FONT,
            fontSize: 10.5,
            color: COLORS.ash,
          }}
        >
          No details available.
        </Typography>
      </Box>
    );
  }

  return (
    <Stack spacing={0}>
      {entries.map(([key, value]) => {
        const label = humanize(key);

        if (Array.isArray(value)) {
          return (
            <EditableArray
              key={key}
              label={label}
              value={value}
              onChange={(next) =>
                updateField(key, next)
              }
              nested
            />
          );
        }

        if (isPlainObject(value)) {
          return (
            <Box key={key} sx={{ mb: 1.25 }}>
              <EditorSectionHeading
                label={label}
                action={
                  nested ? (
                    <RemoveButton
                      label={label}
                      onClick={() =>
                        removeField(key)
                      }
                    />
                  ) : null
                }
              />

              <Box sx={{ pl: { xs: 0, sm: 0.75 } }}>
                <EditableObject
                  value={value}
                  onChange={(next) =>
                    updateField(key, next)
                  }
                  nested
                />
              </Box>
            </Box>
          );
        }

        return (
          <PrimitiveField
            key={key}
            label={label}
            value={value}
            onChange={(next) =>
              updateField(key, next)
            }
            removable={nested}
            onRemove={() =>
              removeField(key)
            }
          />
        );
      })}
    </Stack>
  );
};

/* =========================================================
   SKILL CONTENT EDITOR
========================================================= */

const SkillContentEditor = ({
  draft,
  update,
}) => {
  const entries = Object.entries(draft || {}).filter(
    ([key]) => !SYSTEM_FIELDS.has(key)
  );

  if (!entries.length) {
    return (
      <Typography
        sx={{
          fontFamily: FONT,
          fontSize: 11,
          color: COLORS.ash,
          py: 2,
        }}
      >
        No editable clinical details are available for this skill.
      </Typography>
    );
  }

  return (
    <Stack spacing={0}>
      {entries.map(([key, value]) => {
        const label = humanize(key);

        if (Array.isArray(value)) {
          return (
            <EditableArray
              key={key}
              label={label}
              value={value}
              onChange={(next) =>
                update(key, next)
              }
            />
          );
        }

        if (isPlainObject(value)) {
          return (
            <Box key={key} sx={{ mb: 2 }}>
              <EditorSectionHeading label={label} />

              <Box sx={{ pl: { xs: 0, sm: 0.75 } }}>
                <EditableObject
                  value={value}
                  onChange={(next) =>
                    update(key, next)
                  }
                />
              </Box>
            </Box>
          );
        }

        return (
          <PrimitiveField
            key={key}
            label={label}
            value={value}
            onChange={(next) =>
              update(key, next)
            }
          />
        );
      })}
    </Stack>
  );
};

/* =========================================================
   SKILL EDITOR
========================================================= */

const SkillEditor = ({
  skill,
  onSave,
  saving,
}) => {
  const [draft, setDraft] = useState(() =>
    clone(skill)
  );

  useEffect(() => {
    setDraft(clone(skill));
  }, [skill]);

  if (!draft) {
    return (
      <Box
        sx={{
          minHeight: 300,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: COLORS.white,
        }}
      >
        <Typography
          sx={{
            fontFamily: FONT,
            fontSize: 12,
            color: COLORS.ash,
          }}
        >
          Select a clinical skill to edit.
        </Typography>
      </Box>
    );
  }

  const update = (key, value) => {
    setDraft((previous) => ({
      ...previous,
      [key]: value,
    }));
  };

  const save = () => {
    const overrides = {};

    Object.keys(draft).forEach((key) => {
      if (SYSTEM_FIELDS.has(key)) {
        return;
      }

      overrides[key] = draft[key];
    });

    onSave(
      draft.skill_id,
      draft.enabled !== false,
      overrides
    );
  };

  const displayName =
    draft.name ||
    humanize(draft.skill_id) ||
    "Clinical Skill";

  return (
    <Box
      sx={{
        background: COLORS.white,
        minWidth: 0,
      }}
    >
      {/* Doctor-facing skill header */}
      <Box
        sx={{
          px: { xs: 1.5, sm: 2 },
          py: 1.5,
          borderBottom: `1px solid ${COLORS.mist}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 2,
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography
            sx={{
              fontFamily: FONT,
              fontSize: 16,
              fontWeight: 700,
              color: COLORS.ink,
              lineHeight: 1.3,
            }}
          >
            {displayName}
          </Typography>

          <Typography
            sx={{
              fontFamily: FONT,
              fontSize: 10.5,
              color: COLORS.ash,
              mt: 0.35,
            }}
          >
            {draft.type
              ? humanize(draft.type)
              : "Clinical Expertise"}
          </Typography>
        </Box>

        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 0.75,
            flexShrink: 0,
          }}
        >
          <Typography
            sx={{
              fontFamily: FONT,
              fontSize: 10.5,
              color: COLORS.smoke,
            }}
          >
            Active
          </Typography>

          <Switch
            size="small"
            checked={draft.enabled !== false}
            onChange={(event) =>
              update(
                "enabled",
                event.target.checked
              )
            }
          />
        </Box>
      </Box>

      {/* Clinical content */}
      <Box
        sx={{
          px: { xs: 1.5, sm: 2 },
          py: 1,
        }}
      >
        <SkillContentEditor
          draft={draft}
          update={update}
        />

        <Box
          sx={{
            display: "flex",
            justifyContent: "flex-end",
            pt: 2,
            mt: 1,
            borderTop: `1px solid ${COLORS.mist}`,
          }}
        >
          <Button
            variant="contained"
            startIcon={
              saving ? (
                <CircularProgress
                  size={15}
                  sx={{ color: COLORS.white }}
                />
              ) : (
                <SaveRounded />
              )
            }
            disabled={saving}
            onClick={save}
            sx={{
              fontFamily: FONT,
              fontSize: 11,
              textTransform: "none",
              background: COLORS.ink,
              px: 2,
              "&:hover": {
                background: "#222",
              },
            }}
          >
            {saving ? "Saving…" : "Save Skill"}
          </Button>
        </Box>
      </Box>
    </Box>
  );
};

/* =========================================================
   MAIN COMPONENT
========================================================= */

export default function DoctorSkillSection({
  doctorId,
  open,
  onClose,
}) {
  const [skills, setSkills] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  /* =====================================================
     LOAD SKILLS
  ====================================================== */

  const load = useCallback(async () => {
    if (!doctorId) {
      return;
    }

    setLoading(true);
    setError("");

    try {
      const doctorResponse = await fetch(
        buildDoctorSkillsUrl(doctorId),
        {
          headers: {
            Accept: "application/json",
          },
        }
      );

      const doctorJson =
        await doctorResponse.json();

      if (!doctorResponse.ok) {
        throw new Error(
          doctorJson?.message ||
            "Failed to load doctor skills."
        );
      }

      const loadedSkills =
        Array.isArray(doctorJson?.skills)
          ? doctorJson.skills
          : [];

      const loadedCatalog =
        Array.isArray(doctorJson?.catalog)
          ? doctorJson.catalog
          : [];

      setSkills(loadedSkills);
      setCatalog(loadedCatalog);

      setSelectedId((previous) => {
        if (
          previous &&
          loadedSkills.some(
            (skill) =>
              skill.skill_id === previous
          )
        ) {
          return previous;
        }

        return (
          loadedSkills[0]?.skill_id || ""
        );
      });
    } catch (err) {
      setError(
        err?.message ||
          "Unable to load doctor skills."
      );
    } finally {
      setLoading(false);
    }
  }, [doctorId]);

  /* =====================================================
     LOAD WHEN DIALOG OPENS
  ====================================================== */

  useEffect(() => {
    if (open) {
      load();
    }
  }, [open, load]);

  /* =====================================================
     SELECTED SKILL
  ====================================================== */

  const selectedSkill = useMemo(
    () =>
      skills.find(
        (skill) =>
          skill.skill_id === selectedId
      ) || null,
    [skills, selectedId]
  );

  /* =====================================================
     SAVE SKILL
  ====================================================== */

  const saveSkill = async (
    skillId,
    enabled,
    overrides
  ) => {
    setSaving(true);
    setError("");

    try {
      const response = await fetch(
        buildCustomizeUrl(),
        {
          method: "PUT",
          headers: {
            "Content-Type":
              "application/json",
            Accept:
              "application/json",
          },
          body: JSON.stringify({
            doctor_id: doctorId,
            skill_id: skillId,
            enabled,
            overrides,
          }),
        }
      );

      const json =
        await response.json();

      if (!response.ok) {
        throw new Error(
          json?.message ||
            "Failed to save skill."
        );
      }

      setSkills((previous) =>
        previous.map((skill) =>
          skill.skill_id === skillId
            ? {
                ...skill,
                ...clone(
                  json.effective_skill
                ),
                enabled,
                customized: true,
              }
            : skill
        )
      );

      setMessage(
        "Skill saved for this doctor."
      );
    } catch (err) {
      setError(
        err?.message ||
          "Unable to save skill."
      );
    } finally {
      setSaving(false);
    }
  };

  /* =====================================================
     ADD CATALOG SKILL
  ====================================================== */

  const addCatalogSkill = async (
    skillId
  ) => {
    const catalogSkill =
      catalog.find(
        (skill) =>
          skill.skill_id === skillId
      );

    if (!catalogSkill) {
      return;
    }

    await saveSkill(
      skillId,
      true,
      {}
    );

    setSelectedId(skillId);
  };

  /* =====================================================
     REMOVE SKILL
  ====================================================== */

  const removeSkill = async (skill) => {
    if (!skill) {
      return;
    }

    await saveSkill(
      skill.skill_id,
      false,
      {}
    );
  };

  /* =====================================================
     DOWNLOAD SKILL MARKDOWN
  ====================================================== */

  const downloadSkillMd = () => {
    const activeSkills =
      skills.filter(
        (skill) =>
          skill.enabled !== false
      );

    const markdown = [
      "# Doctor Clinical Expertise Skills",
      "",
      `Doctor ID: ${doctorId}`,
      "",
      ...activeSkills.map(
        (skill) =>
          skillToMarkdown(skill)
      ),
    ].join(
      "\n\n---\n\n"
    );

    downloadText(
      `doctor-${doctorId}-skill.md`,
      markdown
    );
  };

  /* =====================================================
     RENDER
  ====================================================== */

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="lg"
    >
      <DialogTitle
        sx={{
          fontFamily: FONT,
          fontSize: 17,
          fontWeight: 700,
          pb: 1,
        }}
      >
        Clinical Skills
      </DialogTitle>

      <DialogContent
        dividers
        sx={{
          background: COLORS.paper,
        }}
      >
        {error && (
          <Alert
            severity="error"
            sx={{ mb: 1.5 }}
          >
            {error}
          </Alert>
        )}

        {/* Toolbar */}
        <Box
          sx={{
            display: "flex",
            gap: 1,
            flexWrap: "wrap",
            alignItems: "center",
            mb: 1.25,
          }}
        >
          <Chip
            icon={<PsychologyRounded />}
            label={`Doctor: ${
              doctorId || "Not available"
            }`}
            variant="outlined"
          />

          <Button
            size="small"
            startIcon={
              <RefreshRounded />
            }
            onClick={load}
            disabled={loading}
            sx={{
              textTransform: "none",
              fontFamily: FONT,
            }}
          >
            Refresh
          </Button>

          <Button
            size="small"
            startIcon={
              <DownloadRounded />
            }
            onClick={downloadSkillMd}
            disabled={!skills.length}
            sx={{
              textTransform: "none",
              fontFamily: FONT,
            }}
          >
            Download skill.md
          </Button>
        </Box>

        <Divider sx={{ mb: 1.5 }} />

        {loading ? (
          <Box
            sx={{
              minHeight: 300,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <CircularProgress size={30} />
          </Box>
        ) : (
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: {
                xs: "1fr",
                md: "250px minmax(0, 1fr)",
              },
              gap: 2,
              alignItems: "start",
            }}
          >
            {/* =================================================
                LEFT — SIMPLE SKILL NAVIGATION
            ================================================== */}

            <Box
              sx={{
                background: COLORS.white,
                borderRight: {
                  xs: "none",
                  md: `1px solid ${COLORS.mist}`,
                },
                pr: {
                  xs: 0,
                  md: 1.5,
                },
              }}
            >
              <Typography
                sx={{
                  fontFamily: FONT,
                  fontSize: 10,
                  fontWeight: 700,
                  color: COLORS.ash,
                  textTransform:
                    "uppercase",
                  letterSpacing:
                    "0.08em",
                  mb: 0.75,
                }}
              >
                Assigned Skills
              </Typography>

              <Stack spacing={0}>
                {skills.length === 0 ? (
                  <Typography
                    sx={{
                      fontFamily: FONT,
                      fontSize: 11,
                      color: COLORS.ash,
                      py: 1,
                    }}
                  >
                    No skills assigned.
                  </Typography>
                ) : (
                  skills.map((skill) => {
                    const selected =
                      skill.skill_id ===
                      selectedId;

                    const enabled =
                      skill.enabled !== false;

                    return (
                      <Box
                        key={skill.skill_id}
                        role="button"
                        tabIndex={0}
                        onClick={() =>
                          setSelectedId(
                            skill.skill_id
                          )
                        }
                        onKeyDown={(event) => {
                          if (
                            event.key ===
                              "Enter" ||
                            event.key ===
                              " "
                          ) {
                            event.preventDefault();
                            setSelectedId(
                              skill.skill_id
                            );
                          }
                        }}
                        sx={{
                          cursor: "pointer",
                          px: 1,
                          py: 1,
                          borderBottom: `1px solid ${COLORS.mist}`,
                          borderLeft: `3px solid ${
                            selected
                              ? COLORS.ink
                              : "transparent"
                          }`,
                          background:
                            selected
                              ? COLORS.fog
                              : "transparent",
                          "&:hover": {
                            background:
                              COLORS.fog,
                          },
                        }}
                      >
                        <Box
                          sx={{
                            display: "flex",
                            alignItems:
                              "center",
                            justifyContent:
                              "space-between",
                            gap: 0.75,
                          }}
                        >
                          <Typography
                            sx={{
                              fontFamily: FONT,
                              fontSize: 11,
                              fontWeight: 700,
                              color:
                                COLORS.ink,
                            }}
                          >
                            {skill.name ||
                              humanize(
                                skill.skill_id
                              )}
                          </Typography>

                          <Box
                            component="span"
                            sx={{
                              width: 7,
                              height: 7,
                              borderRadius:
                                "50%",
                              background:
                                enabled
                                  ? COLORS.ink
                                  : COLORS.mist,
                              flexShrink: 0,
                            }}
                          />
                        </Box>

                        {skill.type && (
                          <Typography
                            sx={{
                              fontFamily: FONT,
                              fontSize: 9.5,
                              color:
                                COLORS.ash,
                              mt: 0.25,
                            }}
                          >
                            {humanize(
                              skill.type
                            )}
                          </Typography>
                        )}
                      </Box>
                    );
                  })
                )}
              </Stack>

              {/* Add existing skill */}
              <Box sx={{ mt: 2 }}>
                <Typography
                  sx={{
                    fontFamily: FONT,
                    fontSize: 10,
                    color: COLORS.ash,
                    mb: 0.75,
                  }}
                >
                  Add an existing skill
                </Typography>

                <Select
                  fullWidth
                  size="small"
                  displayEmpty
                  value=""
                  onChange={(event) =>
                    addCatalogSkill(
                      event.target.value
                    )
                  }
                  sx={{
                    fontFamily: FONT,
                    fontSize: 11,
                    background:
                      COLORS.white,
                  }}
                >
                  <MenuItem
                    value=""
                    disabled
                    sx={{
                      fontFamily: FONT,
                      fontSize: 11,
                    }}
                  >
                    Add skill…
                  </MenuItem>

                  {catalog
                    .filter(
                      (item) =>
                        !skills.some(
                          (skill) =>
                            skill.skill_id ===
                              item.skill_id &&
                            skill.enabled !==
                              false
                        )
                    )
                    .map((skill) => (
                      <MenuItem
                        key={
                          skill.skill_id
                        }
                        value={
                          skill.skill_id
                        }
                        sx={{
                          fontFamily: FONT,
                          fontSize: 11,
                        }}
                      >
                        {skill.name ||
                          humanize(
                            skill.skill_id
                          )}
                      </MenuItem>
                    ))}
                </Select>
              </Box>

              {selectedSkill && (
                <Button
                  fullWidth
                  color="inherit"
                  startIcon={
                    <DeleteOutlineRounded />
                  }
                  onClick={() =>
                    removeSkill(
                      selectedSkill
                    )
                  }
                  sx={{
                    mt: 1,
                    fontFamily: FONT,
                    fontSize: 10,
                    textTransform:
                      "none",
                    justifyContent:
                      "flex-start",
                    px: 1,
                  }}
                >
                  Remove skill
                </Button>
              )}
            </Box>

            {/* =================================================
                RIGHT — DOCTOR-FRIENDLY EDITOR
            ================================================== */}

            <Box
              sx={{
                background: COLORS.white,
                minWidth: 0,
              }}
            >
              <SkillEditor
                skill={selectedSkill}
                onSave={saveSkill}
                saving={saving}
              />
            </Box>
          </Box>
        )}
      </DialogContent>

      <DialogActions>
        <Button
          onClick={onClose}
          startIcon={<CloseRounded />}
          sx={{
            fontFamily: FONT,
            textTransform: "none",
          }}
        >
          Close
        </Button>
      </DialogActions>

      <Snackbar
        open={Boolean(message)}
        autoHideDuration={2500}
        onClose={() =>
          setMessage("")
        }
        message={message}
      />
    </Dialog>
  );
}
