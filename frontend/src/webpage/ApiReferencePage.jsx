import React, { useState } from 'react';
import * as XLSX from 'xlsx';
import SaveEndpointStepImg from '../assets/Screenshot 2026-06-01 191151.png';
import SaveEndpoint from '../assets/Screenshot 2026-06-01 191138.png'
const SIDEBAR_WIDTH = "248px";

const T = {
  bg: "#ffffff",
  bgAlt: "#fafafa",
  bgTert: "#f5f5f5",
  text: "#000000",
  textSec: "#444444",
  textMuted: "#888888",
  border: "#e0e0e0",
  borderStr: "#000000",
  accent: "#000000",
  accentLight: "#2a2a2a",
  accentGlow: "rgba(0,0,0,0.03)",
};

const S = {
  layout: {
    display: "flex",
    minHeight: "100vh",
    background: T.bg,
    fontFamily: "'Open Sans', sans-serif",
    fontWeight: 300,
    WebkitFontSmoothing: "antialiased",
    color: T.text,
  },
  sidebar: {
    width: SIDEBAR_WIDTH,
    minHeight: "100vh",
    position: "fixed",
    left: 0, top: 0,
    background: T.bg,
    borderRight: `1px solid ${T.border}`,
    display: "flex",
    flexDirection: "column",
    zIndex: 200,
    overflowY: "auto",
    transition: "transform 0.3s ease",
  },
  sidebarHeader: {
    padding: "1.5rem 1.5rem 1rem",
    borderBottom: `1px solid ${T.border}`,
    flexShrink: 0,
    background: `linear-gradient(135deg, ${T.bg} 0%, ${T.bgAlt} 100%)`,
  },
  brandRow: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    marginBottom: "1.25rem",
  },
  brandName: {
    fontWeight: 400,
    fontSize: "0.9rem",
    letterSpacing: "-0.01em",
    color: T.text,
    margin: 0,
  },
  sectionLabel: {
    fontSize: "0.6rem",
    textTransform: "uppercase",
    letterSpacing: "0.18em",
    color: T.textMuted,
    fontWeight: 400,
    display: "block",
    marginBottom: "0.25rem",
  },
  doctorName: {
    fontSize: "0.9rem",
    fontWeight: 400,
    color: T.text,
    margin: 0,
  },
  menuScroll: {
    flex: 1,
    overflowY: "auto",
    padding: "0.75rem 0",
  },
  navGroupLabel: {
    fontSize: "0.58rem",
    textTransform: "uppercase",
    letterSpacing: "0.15em",
    color: T.textMuted,
    fontWeight: 400,
    padding: "0.5rem 0.75rem 0.25rem",
    display: "block",
  },
  navBtn: {
    width: "100%",
    background: "transparent",
    border: "none",
    textAlign: "left",
    padding: "0.55rem 1.25rem",
    fontSize: "0.78rem",
    fontWeight: 300,
    color: T.textSec,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: "10px",
    transition: "all 0.2s ease",
    fontFamily: "'Open Sans', sans-serif",
    borderLeft: "2px solid transparent",
    position: "relative",
  },
  navBtnActive: {
    background: `linear-gradient(90deg, ${T.bgAlt} 0%, ${T.bg} 100%)`,
    color: T.text,
    fontWeight: 400,
    borderLeft: `2px solid ${T.accent}`,
  },
  sidebarFooter: {
    padding: "1rem 1.25rem",
    borderTop: `1px solid ${T.border}`,
    flexShrink: 0,
    background: T.bgAlt,
  },
  logoutBtn: {
    width: "100%",
    background: "transparent",
    border: `1px solid ${T.border}`,
    padding: "0.6rem 1rem",
    fontSize: "0.75rem",
    fontWeight: 400,
    color: T.textSec,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    fontFamily: "'Open Sans', sans-serif",
    transition: "all 0.2s",
  },
  main: {
    flex: 1,
    marginLeft: SIDEBAR_WIDTH,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    transition: "margin-left 0.3s ease",
  },
  topBar: {
    position: "sticky",
    top: 0,
    background: `linear-gradient(135deg, ${T.bg} 0%, ${T.bgAlt} 100%)`,
    borderBottom: `1px solid ${T.border}`,
    padding: "0.875rem 2rem",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    zIndex: 100,
    gap: "12px",
  },
  topBarLeft: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
  },
  topBarTitle: {
    fontSize: "1rem",
    fontWeight: 400,
    color: T.text,
    letterSpacing: "-0.01em",
    margin: 0,
  },
  body: {
    padding: "2rem",
    flex: 1,
    background: T.bgAlt,
  },
  sectionCard: {
    background: T.bg,
    border: `1px solid ${T.border}`,
    marginBottom: "2rem",
    borderRadius: "4px",
    boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
    transition: "box-shadow 0.2s ease",
  },
  sectionHeader: {
    padding: "1.25rem 1.5rem",
    borderBottom: `1px solid ${T.border}`,
    background: `linear-gradient(135deg, ${T.bg} 0%, ${T.bgAlt} 50%)`,
    borderTopLeftRadius: "4px",
    borderTopRightRadius: "4px",
  },
  sectionTitle: {
    fontSize: "0.85rem",
    fontWeight: 400,
    color: T.text,
    margin: 0,
    letterSpacing: "0.02em",
  },
  sectionSub: {
    fontSize: "0.7rem",
    color: T.textMuted,
    marginTop: "4px",
  },
  contentArea: {
    padding: "1.5rem",
  },
  methodBadge: {
    padding: "2px 8px",
    fontSize: "0.6rem",
    fontWeight: 400,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    border: `1px solid ${T.border}`,
    display: "inline-block",
    background: T.bgAlt,
    color: T.textSec,
    borderRadius: "2px",
  },
  methodBadgePost: {
    borderColor: T.text,
    background: T.text,
    color: T.bg,
  },
  methodBadgeGet: {
    borderColor: T.text,
    background: T.text,
    color: T.bg,
  },
  methodBadgeWidget: {
    borderColor: "#555",
    background: "#555",
    color: T.bg,
  },
  codeBlock: {
    background: T.bgAlt,
    padding: "1rem",
    fontSize: "0.75rem",
    fontFamily: "monospace",
    overflowX: "auto",
    margin: 0,
    border: `1px solid ${T.border}`,
    borderRadius: "4px",
  },
  copyBtn: {
    position: "absolute",
    top: "8px",
    right: "8px",
    background: T.bg,
    border: `1px solid ${T.border}`,
    padding: "4px 10px",
    fontSize: "0.65rem",
    cursor: "pointer",
    fontFamily: "'Open Sans', sans-serif",
    borderRadius: "2px",
    transition: "all 0.2s",
    fontWeight: 300,
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: "0.78rem",
  },
  th: {
    textAlign: "left",
    padding: "0.75rem 1rem",
    fontWeight: 400,
    color: T.textMuted,
    borderBottom: `1px solid ${T.border}`,
    fontSize: "0.65rem",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    background: T.bgAlt,
  },
  td: {
    padding: "0.75rem 1rem",
    borderBottom: `1px solid ${T.border}`,
    color: T.textSec,
  },
  accentBar: {
    height: "3px",
    background: `linear-gradient(90deg, ${T.text} 0%, ${T.textMuted} 50%, transparent 100%)`,
    width: "100%",
  },
  statHighlight: {
    display: "inline-block",
    background: T.text,
    color: T.bg,
    padding: "2px 6px",
    fontSize: "0.6rem",
    borderRadius: "2px",
    marginLeft: "8px",
  },
  infoBox: {
    background: "#f0f7ff",
    border: "1px solid #cce0ff",
    borderRadius: "4px",
    padding: "0.875rem 1rem",
    fontSize: "0.78rem",
    color: "#1a4a7a",
    marginBottom: "1rem",
    lineHeight: 1.6,
  },
  warningBox: {
    background: "#fffbf0",
    border: "1px solid #ffe0a0",
    borderRadius: "4px",
    padding: "0.875rem 1rem",
    fontSize: "0.78rem",
    color: "#7a5a00",
    marginBottom: "1rem",
    lineHeight: 1.6,
  },
  stepBadge: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "22px",
    height: "22px",
    borderRadius: "50%",
    background: T.text,
    color: T.bg,
    fontSize: "0.65rem",
    fontWeight: 400,
    flexShrink: 0,
  },
  widgetCard: {
    background: T.bgAlt,
    border: `1px solid ${T.border}`,
    borderRadius: "4px",
    padding: "1rem 1.25rem",
    marginBottom: "0.75rem",
  },
  widgetCardTitle: {
    fontSize: "0.8rem",
    fontWeight: 400,
    color: T.text,
    margin: "0 0 4px 0",
  },
  widgetCardSub: {
    fontSize: "0.7rem",
    color: T.textMuted,
    margin: 0,
    lineHeight: 1.5,
  },
  tabBar: {
    display: "flex",
    borderBottom: `1px solid ${T.border}`,
    background: T.bg,
    padding: "0 2rem",
    gap: "0",
  },
  tabBtn: {
    padding: "0.75rem 1.25rem",
    fontSize: "0.78rem",
    fontWeight: 300,
    color: T.textSec,
    background: "transparent",
    border: "none",
    borderBottom: "2px solid transparent",
    cursor: "pointer",
    fontFamily: "'Open Sans', sans-serif",
    transition: "all 0.2s",
    marginBottom: "-1px",
  },
  tabBtnActive: {
    color: T.text,
    fontWeight: 400,
    borderBottom: `2px solid ${T.text}`,
  },
};

const DoctorAssistApiReference = () => {
  const [copiedText, setCopiedText] = useState(null);
  const [selectedSection, setSelectedSection] = useState('authentication');
  const [activeTab, setActiveTab] = useState('api');
  const [authLanguage, setAuthLanguage] = useState('python');
  const [refreshLanguage, setRefreshLanguage] = useState('python');
  const [widgetSubSection, setWidgetSubSection] = useState('overview');
  const [demoLanguage, setDemoLanguage] = useState('python');
  const [vitalsLanguage, setVitalsLanguage] = useState('python');
  const [appointmentLanguage, setAppointmentLanguage] = useState('python');
  const [reportsLanguage, setReportsLanguage] = useState('python');
  const [labReportsLanguage, setLabReportsLanguage] = useState('python');
  const [visitHistoryLanguage, setVisitHistoryLanguage] = useState('python');

  // ── Save Endpoint shared state ──
  const [saveEndpointUrl, setSaveEndpointUrl] = useState('');
  const [saveClientId, setSaveClientId] = useState('');
  const [saveClientSecret, setSaveClientSecret] = useState('');
  const [endpointSaved, setEndpointSaved] = useState(false);
  const [endpointSaving, setEndpointSaving] = useState(false);

  const copyToClipboard = (text, id) => {
    navigator.clipboard.writeText(text);
    setCopiedText(id);
    setTimeout(() => setCopiedText(null), 2000);
  };

  const navSections = [
    {
      label: "Authentication",
      items: [
        { id: 'authentication', label: 'Get Bearer Token', method: 'POST' },
        { id: 'refreshToken', label: 'Refresh Bearer Token', method: 'POST' },
      ],
    },
    {
      label: "POST Endpoints",
      items: [
        { id: 'patientDemographics', label: 'Patient Demographics', method: 'POST' },
        { id: 'appointments', label: 'Appointments', method: 'POST' },
        { id: 'patientVitals', label: 'Patient Vitals', method: 'POST' },
        { id: 'reports', label: 'Upload Reports', method: 'POST' },
        { id: 'labReports', label: 'Lab Reports', method: 'POST' },
        { id: 'visitHistory', label: 'Visit History', method: 'POST' },
      ],
    }
  ];

  const widgetNavSections = [
    {
      label: "Getting Started",
      items: [
        { id: 'overview', label: 'Overview', method: 'WEB' },
        { id: 'setup', label: 'Setup & Installation', method: 'WEB' },
        { id: 'validation', label: 'Session Validation', method: 'POST' },
      ],
    },
    {
      label: "Widgets",
      items: [
        { id: 'w-patient', label: 'Patient Summary', method: 'WDG' },
        { id: 'w-transcription', label: 'Transcription', method: 'WDG' },
        { id: 'w-diagnosis', label: 'Diagnosis', method: 'WDG' },
        { id: 'w-treatmentplan', label: 'Treatment Plan', method: 'WDG' },
        { id: 'w-combined', label: 'Combined Documentation', method: 'WDG' },
        
        { id: 'w-reportupload', label: 'Report Upload', method: 'WDG' },
      ],
    },
    {
      label: "Reference",
      items: [
        { id: 'w-globaldata', label: 'Global Data Object', method: 'REF' },
        { id: 'w-fullexample', label: 'Full HTML Example', method: 'HTML' },
      ],
    },
  ];

  // ─── Code Examples ───
  const authCodeExamples = {
    python: `import requests

currenttoken = None  # Global variable to hold the access token

def fetch_new_token(client_id, client_secret):
    global currenttoken
    url = "https://doctorassist.ai/api/hms/users/auth/integrators/token"
    data = {
        "client_id": client_id,
        "client_secret": client_secret
    }
    response = requests.post(url, json=data)
    if response.status_code == 200:
        access_token = response.json().get("access_token")
        currenttoken = access_token
        return access_token
    print("Failed to fetch token:", response.status_code, response.text)
    return None`,
    java: `import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;

public class TokenManager {

    public static String currentToken = null;

    public static String fetchNewToken(String clientId, String clientSecret) throws IOException {
        URL url = new URL("https://doctorassist.ai/api/hms/users/auth/integrators/token");
        HttpURLConnection con = (HttpURLConnection) url.openConnection();
        con.setRequestMethod("POST");
        con.setRequestProperty("Content-Type", "application/json");
        con.setDoOutput(true);

        String jsonInput = String.format(
            "{\"client_id\":\"%s\",\"client_secret\":\"%s\"}",
            clientId, clientSecret
        );

        try(OutputStream os = con.getOutputStream()) {
            byte[] input = jsonInput.getBytes("utf-8");
            os.write(input, 0, input.length);
        }

        int status = con.getResponseCode();
        InputStream is = (status == 200) ? con.getInputStream() : con.getErrorStream();
        BufferedReader br = new BufferedReader(new InputStreamReader(is, "utf-8"));
        StringBuilder response = new StringBuilder();
        String line;
        while((line = br.readLine()) != null) response.append(line.trim());

        if(status == 200) {
            String resp = response.toString();
            int start = resp.indexOf("\"access_token\":\"") + 16;
            int end = resp.indexOf("\"", start);
            if(start > 15 && end > start) {
                String accessToken = resp.substring(start, end);
                currentToken = accessToken;
                return accessToken;
            }
        } else {
            System.out.println("Failed to fetch token: " + status);
        }

        return null;
    }
}`,
    c: `#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <curl/curl.h>

char currenttoken[1024] = "";

struct MemoryStruct {
    char *memory;
    size_t size;
};

static size_t WriteMemoryCallback(void *contents, size_t size, size_t nmemb, void *userp) {
    size_t realsize = size * nmemb;
    struct MemoryStruct *mem = (struct MemoryStruct *)userp;
    char *ptr = realloc(mem->memory, mem->size + realsize + 1);
    if(!ptr) return 0;
    mem->memory = ptr;
    memcpy(&(mem->memory[mem->size]), contents, realsize);
    mem->size += realsize;
    mem->memory[mem->size] = 0;
    return realsize;
}

char* fetch_new_token(const char* client_id, const char* client_secret) {
    CURL *curl = curl_easy_init();
    if(!curl) return NULL;

    struct MemoryStruct chunk;
    chunk.memory = malloc(1);
    chunk.size = 0;

    char postfields[512];
    snprintf(postfields, sizeof(postfields),
             "{\"client_id\":\"%s\",\"client_secret\":\"%s\"}",
             client_id, client_secret);

    struct curl_slist *headers = NULL;
    headers = curl_slist_append(headers, "Content-Type: application/json");

    curl_easy_setopt(curl, CURLOPT_URL, "https://doctorassist.ai/api/hms/users/auth/integrators/token");
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, postfields);
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, WriteMemoryCallback);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, (void*)&chunk);

    CURLcode res = curl_easy_perform(curl);

    char *token_start = strstr(chunk.memory, "\"access_token\":\"");
    if(token_start) {
        token_start += 16;
        char *token_end = strchr(token_start, '"');
        if(token_end) {
            size_t len = token_end - token_start;
            strncpy(currenttoken, token_start, len);
            currenttoken[len] = '\\0';
        }
    }

    curl_easy_cleanup(curl);
    free(chunk.memory);
    return currenttoken;
}`,
    cpp: `#include <iostream>
#include <string>
#include <curl/curl.h>

std::string currentToken = "";

struct MemoryStruct {
    char *memory;
    size_t size;
};

static size_t WriteMemoryCallback(void* contents, size_t size, size_t nmemb, void* userp) {
    size_t realsize = size * nmemb;
    MemoryStruct* mem = (MemoryStruct*)userp;
    char* ptr = (char*)realloc(mem->memory, mem->size + realsize + 1);
    if(!ptr) return 0;
    mem->memory = ptr;
    memcpy(&(mem->memory[mem->size]), contents, realsize);
    mem->size += realsize;
    mem->memory[mem->size] = 0;
    return realsize;
}

std::string fetchNewToken(const std::string& clientId, const std::string& clientSecret) {
    CURL* curl = curl_easy_init();
    if(!curl) return "";

    MemoryStruct chunk;
    chunk.memory = (char*)malloc(1);
    chunk.size = 0;

    std::string postfields = "{\\"client_id\\":\\"" + clientId + "\\",\\"client_secret\\":\\"" + clientSecret + "\\"}";

    struct curl_slist* headers = NULL;
    headers = curl_slist_append(headers, "Content-Type: application/json");

    curl_easy_setopt(curl, CURLOPT_URL, "https://doctorassist.ai/api/hms/users/auth/integrators/token");
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, postfields.c_str());
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, WriteMemoryCallback);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, (void*)&chunk);

    curl_easy_perform(curl);

    std::string response(chunk.memory);
    free(chunk.memory);
    curl_easy_cleanup(curl);

    size_t pos_start = response.find("\\"access_token\\":\\"");
    if(pos_start != std::string::npos) {
        pos_start += 16;
        size_t pos_end = response.find("\\"", pos_start);
        if(pos_end != std::string::npos) {
            currentToken = response.substr(pos_start, pos_end - pos_start);
        }
    }

    return currentToken;
}`,
  };

  const refreshCodeExamples = {
    python: `import requests

currenttoken = None

def refresh_token(current_token=None):
    client_id = "YOUR_CLIENT_ID"
    client_secret = "YOUR_CLIENT_SECRET"
    
    url = "https://doctorassist.ai/api/hms/users/auth/integrators/token"
    data = {"client_id": client_id, "client_secret": client_secret}
    headers = {
        "Authorization": f"Bearer {current_token}" if current_token else "",
        "Content-Type": "application/json"
    }
    
    response = requests.post(url, headers=headers, json=data)
    
    if response.status_code == 200:
        global currenttoken
        currenttoken = response.json().get("access_token")
        return currenttoken
    
    print("Failed to get token:", response.status_code, response.text)
    return None`,
    java: `import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;

public class TokenManager {
    public static String currentToken = null;

    public static String refreshToken(String oldToken) throws IOException {
        String clientId = "YOUR_CLIENT_ID";
        String clientSecret = "YOUR_CLIENT_SECRET";

        URL url = new URL("https://doctorassist.ai/api/hms/users/auth/integrators/token");
        HttpURLConnection con = (HttpURLConnection) url.openConnection();
        con.setRequestMethod("POST");
        con.setRequestProperty("Content-Type", "application/json");
        if(oldToken != null && !oldToken.isEmpty()) {
            con.setRequestProperty("Authorization", "Bearer " + oldToken);
        }
        con.setDoOutput(true);

        String jsonInputString = String.format(
            "{\"client_id\":\"%s\",\"client_secret\":\"%s\"}",
            clientId, clientSecret
        );

        try(OutputStream os = con.getOutputStream()) {
            byte[] input = jsonInputString.getBytes("utf-8");
            os.write(input, 0, input.length);
        }

        BufferedReader br = new BufferedReader(new InputStreamReader(con.getInputStream(), "utf-8"));
        StringBuilder response = new StringBuilder();
        String responseLine;
        while ((responseLine = br.readLine()) != null) {
            response.append(responseLine.trim());
        }

        currentToken = "NEW_BEARER_TOKEN_FROM_SERVER";
        return currentToken;
    }
}`,
    c: `char* refresh_token(const char* old_token) {
    const char* client_id = "YOUR_CLIENT_ID";
    const char* client_secret = "YOUR_CLIENT_SECRET";

    CURL *curl = curl_easy_init();
    if(!curl) return NULL;

    struct MemoryStruct chunk;
    chunk.memory = malloc(1);
    chunk.size = 0;

    char postfields[512];
    snprintf(postfields, sizeof(postfields),
        "{\"client_id\":\"%s\",\"client_secret\":\"%s\"}",
        client_id, client_secret);

    struct curl_slist *headers = NULL;
    headers = curl_slist_append(headers, "Content-Type: application/json");

    char auth_header[256];
    if(old_token && strlen(old_token) > 0)
        snprintf(auth_header, sizeof(auth_header), "Authorization: Bearer %s", old_token);
    else
        snprintf(auth_header, sizeof(auth_header), "Authorization: ");

    headers = curl_slist_append(headers, auth_header);

    curl_easy_setopt(curl, CURLOPT_URL, "https://doctorassist.ai/api/hms/users/auth/integrators/token");
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, postfields);
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, WriteMemoryCallback);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, (void *)&chunk);

    curl_easy_perform(curl);

    cJSON *json = cJSON_Parse(chunk.memory);
    if(json) {
        cJSON *token_json = cJSON_GetObjectItem(json, "access_token");
        if(token_json && token_json->valuestring) {
            strncpy(currenttoken, token_json->valuestring, sizeof(currenttoken)-1);
        }
        cJSON_Delete(json);
    }

    curl_easy_cleanup(curl);
    free(chunk.memory);
    return currenttoken;
}`,
    cpp: `std::string refreshToken(const std::string& oldToken = "") {
    std::string clientId = "YOUR_CLIENT_ID";
    std::string clientSecret = "YOUR_CLIENT_SECRET";

    CURL* curl = curl_easy_init();
    if (!curl) return "";

    MemoryStruct chunk;
    chunk.memory = (char*)malloc(1);
    chunk.size = 0;

    std::string postfields = "{\\"client_id\\":\\"" + clientId + "\\",\\"client_secret\\":\\"" + clientSecret + "\\"}";

    struct curl_slist* headers = NULL;
    headers = curl_slist_append(headers, "Content-Type: application/json");

    std::string authHeader = "Authorization: Bearer " + oldToken;
    if (oldToken.empty()) authHeader = "Authorization: ";
    headers = curl_slist_append(headers, authHeader.c_str());

    curl_easy_setopt(curl, CURLOPT_URL, "https://doctorassist.ai/api/hms/users/auth/integrators/token");
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, postfields.c_str());
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, WriteMemoryCallback);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, (void*)&chunk);

    curl_easy_perform(curl);

    currentToken = "NEW_BEARER_TOKEN_FROM_SERVER";

    curl_easy_cleanup(curl);
    free(chunk.memory);
    return currentToken;
}`,
  };

  const demographicsCodeExamples = {
    python: `def send_patient_demographics():
    global currenttoken
    token = refresh_token(currenttoken)

    patient_data = {
        "hospital_id": "YOUR_HOSPITAL_ID",
        "hms_patient_id": "YOUR_PATIENT_ID",
        "demographics": {
            "name": "PATIENT_NAME",
            "dob": "YYYY-MM-DD",
            "sex": "M/F",
            "phone": "+1234567890",
            "mrn": "MRN_NUMBER",
            "email": "patient@example.com",
            "blood_group": "BLOOD_GROUP",
            "marital_status": "Single/Married",
            "address": "PATIENT_ADDRESS",
            "occupation": "OCCUPATION",
            "education": "EDUCATION_LEVEL",
            "family_history": "FAMILY_HISTORY"
        },
        "insurance_profile": {
            "payer_scheme": "SCHEME_NAME",
            "country": "COUNTRY",
            "primary": {
                "payer_name": "INSURANCE_PROVIDER",
                "payer_code": "PROVIDER_CODE",
                "policy_number": "POLICY_NUMBER",
                "member_id": "MEMBER_ID",
                "coverage_plan": "PLAN_NAME",
                "valid_from": "YYYY-MM-DD",
                "valid_to": "YYYY-MM-DD",
                "relationship_to_insured": "Self/Spouse/Child",
                "co_pay_percent": 20,
                "deductible_amount": 50.0,
                "max_annual_limit": 500000.0,
                "exclusions": ["EXCLUSION_1"],
                "consents": {"insurance_data_share": True, "claim_submission": True}
            },
            "secondary": None
        }
    }

    url = "https://doctorassist.ai/api/hms/integration/system/patient-demographics"
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    response = requests.post(url, headers=headers, json=patient_data)
    print(response.status_code, response.text)`,
    java: `public static void sendPatientDemographics() throws IOException {
    String token = TokenManager.refreshToken(TokenManager.currentToken);
    if(token == null || token.isEmpty()) return;

    URL url = new URL("https://doctorassist.ai/api/hms/integration/system/patient-demographics");
    HttpURLConnection con = (HttpURLConnection) url.openConnection();
    con.setRequestMethod("POST");
    con.setRequestProperty("Authorization", "Bearer " + token);
    con.setRequestProperty("Content-Type", "application/json");
    con.setDoOutput(true);

    String jsonData = "{"
        + "\\"hospital_id\\":\\"YOUR_HOSPITAL_ID\\"," 
        + "\\"hms_patient_id\\":\\"YOUR_PATIENT_ID\\","
        + "\\"demographics\\":{\\"name\\":\\"PATIENT_NAME\\",...}"
    + "}";

    try(OutputStream os = con.getOutputStream()) {
        os.write(jsonData.getBytes("utf-8"));
    }

    BufferedReader br = new BufferedReader(new InputStreamReader(con.getInputStream()));
    StringBuilder response = new StringBuilder();
    String line;
    while((line = br.readLine()) != null) response.append(line);
    System.out.println(response.toString());
}`,
    c: `void send_patient_demographics() {
    char* token = refresh_token(currenttoken);
    if(!token || strlen(token) == 0) return;

    CURL *curl = curl_easy_init();
    if(!curl) return;

    const char* json_data =
    "{"
        "\\"hospital_id\\":\\"YOUR_HOSPITAL_ID\\"," 
        "\\"hms_patient_id\\":\\"YOUR_PATIENT_ID\\"," 
        "\\"demographics\\":{\\"name\\":\\"PATIENT_NAME\\",...}"
    "}";

    struct curl_slist *headers = NULL;
    char auth_header[256];
    snprintf(auth_header, sizeof(auth_header), "Authorization: Bearer %s", token);
    headers = curl_slist_append(headers, auth_header);
    headers = curl_slist_append(headers, "Content-Type: application/json");

    curl_easy_setopt(curl, CURLOPT_URL, "https://doctorassist.ai/api/hms/integration/system/patient-demographics");
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, json_data);
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, WriteMemoryCallback);

    curl_easy_perform(curl);
    curl_easy_cleanup(curl);
}`,
    cpp: `void sendPatientDemographics() {
    std::string token = refreshToken(currentToken);
    if (token.empty()) return;

    CURL* curl = curl_easy_init();
    if (!curl) return;

    const char* jsonData =
    "{"
        "\\"hospital_id\\":\\"YOUR_HOSPITAL_ID\\"," 
        "\\"hms_patient_id\\":\\"YOUR_PATIENT_ID\\"," 
        "\\"demographics\\":{\\"name\\":\\"PATIENT_NAME\\",...}"
    "}";

    struct curl_slist* headers = NULL;
    std::string authHeader = "Authorization: Bearer " + token;
    headers = curl_slist_append(headers, authHeader.c_str());
    headers = curl_slist_append(headers, "Content-Type: application/json");

    curl_easy_setopt(curl, CURLOPT_URL, "https://doctorassist.ai/api/hms/integration/system/patient-demographics");
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, jsonData);

    curl_easy_perform(curl);
    curl_easy_cleanup(curl);
}`,
  };

  const vitalsCodeExamples = {
    python: `def send_patient_vitals():
    token = refresh_token(currenttoken)
    if not token:
        return

    vitals_data = {
        "hospital_id": "YOUR_HOSPITAL_ID",
        "doctor_id": "YOUR_DOCTOR_ID",
        "patient_id": "YOUR_PATIENT_ID",
        "appointment_id": "YOUR_APPOINTMENT_ID",
        "vitals": {
            "2026-01-25T10:30:00": {
                "bp": "120/80",
                "pulse": 72,
                "temperature": 98.6,
                "respiratory_rate": 16,
                "spo2": 99,
                "weight": 68,
                "height": 172
            }
        }
    }

    url = "https://doctorassist.ai/api/hms/integration/system/save_patient_vitals"
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    response = requests.post(url, headers=headers, json=vitals_data)
    print(response.status_code, response.json())`,
    java: `public static void sendPatientVitals() throws IOException {
    String token = TokenManager.refreshToken(TokenManager.currentToken);
    if(token == null || token.isEmpty()) return;

    URL url = new URL("https://doctorassist.ai/api/hms/integration/system/save_patient_vitals");
    HttpURLConnection con = (HttpURLConnection) url.openConnection();
    con.setRequestMethod("POST");
    con.setRequestProperty("Authorization", "Bearer " + token);
    con.setRequestProperty("Content-Type", "application/json");
    con.setDoOutput(true);

    String jsonData = "{"
        + "\\"hospital_id\\":\\"YOUR_HOSPITAL_ID\\"," 
        + "\\"doctor_id\\":\\"YOUR_DOCTOR_ID\\"," 
        + "\\"patient_id\\":\\"YOUR_PATIENT_ID\\"," 
        + "\\"appointment_id\\":\\"YOUR_APPOINTMENT_ID\\"," 
        + "\\"vitals\\":{\\"2026-01-25T10:30:00\\":{\\"bp\\":\\"120/80\\",\\"pulse\\":72}}"
    + "}";

    try(OutputStream os = con.getOutputStream()) {
        os.write(jsonData.getBytes("utf-8"));
    }

    BufferedReader br = new BufferedReader(new InputStreamReader(con.getInputStream()));
    StringBuilder response = new StringBuilder();
    String line;
    while((line = br.readLine()) != null) response.append(line);
    System.out.println(response.toString());
}`,
    c: `void send_patient_vitals() {
    char *token = refresh_token(currenttoken);
    if(!token || strlen(token) == 0) return;

    CURL *curl = curl_easy_init();
    if(!curl) return;

    const char* json_data =
    "{"
        "\\"hospital_id\\":\\"YOUR_HOSPITAL_ID\\"," 
        "\\"doctor_id\\":\\"YOUR_DOCTOR_ID\\"," 
        "\\"patient_id\\":\\"YOUR_PATIENT_ID\\"," 
        "\\"appointment_id\\":\\"YOUR_APPOINTMENT_ID\\"," 
        "\\"vitals\\":{\\"2026-01-25T10:30:00\\":{\\"bp\\":\\"120/80\\",\\"pulse\\":72}}"
    "}";

    struct curl_slist *headers = NULL;
    char auth_header[512];
    snprintf(auth_header, sizeof(auth_header), "Authorization: Bearer %s", token);
    headers = curl_slist_append(headers, auth_header);
    headers = curl_slist_append(headers, "Content-Type: application/json");

    curl_easy_setopt(curl, CURLOPT_URL, "https://doctorassist.ai/api/hms/integration/system/save_patient_vitals");
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, json_data);
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, WriteMemoryCallback);

    curl_easy_perform(curl);
    curl_easy_cleanup(curl);
}`,
    cpp: `void sendPatientVitals() {
    std::string token = refreshToken(currentToken);
    if(token.empty()) return;

    CURL* curl = curl_easy_init();
    if(!curl) return;

    const char* jsonData =
    "{"
        "\\"hospital_id\\":\\"YOUR_HOSPITAL_ID\\"," 
        "\\"doctor_id\\":\\"YOUR_DOCTOR_ID\\"," 
        "\\"patient_id\\":\\"YOUR_PATIENT_ID\\"," 
        "\\"appointment_id\\":\\"YOUR_APPOINTMENT_ID\\"," 
        "\\"vitals\\":{\\"2026-01-25T10:30:00\\":{\\"bp\\":\\"120/80\\",\\"pulse\\":72}}"
    "}";

    struct curl_slist* headers = NULL;
    std::string authHeader = "Authorization: Bearer " + token;
    headers = curl_slist_append(headers, authHeader.c_str());
    headers = curl_slist_append(headers, "Content-Type: application/json");

    curl_easy_setopt(curl, CURLOPT_URL, "https://doctorassist.ai/api/hms/integration/system/save_patient_vitals");
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, jsonData);

    curl_easy_perform(curl);
    curl_easy_cleanup(curl);
}`,
  };

  const appointmentCodeExamples = {
    python: `def send_appointment():
    token = refresh_token(currenttoken)
    if not token:
        return

    appointment_data = {
        "hospital_id": "YOUR_HOSPITAL_ID",
        "doctor_id": "YOUR_DOCTOR_ID",
        "patient_id": "YOUR_PATIENT_ID",
        "date": "YYYY-MM-DD",
        "scheduled_time": "HH:MM",
        "visit_type": "new/follow-up/emergency",
        "appointment_id": "YOUR_APPOINTMENT_ID",
        "chief_complaint": "Patient's chief complaint"
    }

    url = "https://doctorassist.ai/api/hms/integration/system/take_appointment"
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    response = requests.post(url, headers=headers, json=appointment_data)
    print(response.status_code, response.json())`,
    java: `public static void sendAppointment() throws IOException {
    String token = TokenManager.refreshToken(TokenManager.currentToken);
    if(token == null || token.isEmpty()) return;

    URL url = new URL("https://doctorassist.ai/api/hms/integration/system/take_appointment");
    HttpURLConnection con = (HttpURLConnection) url.openConnection();
    con.setRequestMethod("POST");
    con.setRequestProperty("Authorization", "Bearer " + token);
    con.setRequestProperty("Content-Type", "application/json");
    con.setDoOutput(true);

    String jsonData = "{"
        + "\\"hospital_id\\":\\"YOUR_HOSPITAL_ID\\"," 
        + "\\"doctor_id\\":\\"YOUR_DOCTOR_ID\\"," 
        + "\\"patient_id\\":\\"YOUR_PATIENT_ID\\"," 
        + "\\"date\\":\\"YYYY-MM-DD\\"," 
        + "\\"scheduled_time\\":\\"HH:MM\\"," 
        + "\\"visit_type\\":\\"new/follow-up/emergency\\"," 
        + "\\"appointment_id\\":\\"YOUR_APPOINTMENT_ID\\"," 
        + "\\"chief_complaint\\":\\"Patient chief complaint\\""
    + "}";

    try(OutputStream os = con.getOutputStream()) {
        os.write(jsonData.getBytes("utf-8"));
    }

    System.out.println(new BufferedReader(new InputStreamReader(con.getInputStream())).lines().collect(java.util.stream.Collectors.joining()));
}`,
    c: `void send_appointment() {
    char *token = refresh_token(currenttoken);
    if(!token || strlen(token) == 0) return;

    CURL *curl = curl_easy_init();
    if(!curl) return;

    const char* json_data =
    "{"
        "\\"hospital_id\\":\\"YOUR_HOSPITAL_ID\\"," 
        "\\"doctor_id\\":\\"YOUR_DOCTOR_ID\\"," 
        "\\"patient_id\\":\\"YOUR_PATIENT_ID\\"," 
        "\\"date\\":\\"YYYY-MM-DD\\"," 
        "\\"scheduled_time\\":\\"HH:MM\\"," 
        "\\"visit_type\\":\\"new\\"," 
        "\\"appointment_id\\":\\"YOUR_APPOINTMENT_ID\\"," 
        "\\"chief_complaint\\":\\"Chief complaint\\""
    "}";

    struct curl_slist *headers = NULL;
    char auth_header[512];
    snprintf(auth_header, sizeof(auth_header), "Authorization: Bearer %s", token);
    headers = curl_slist_append(headers, auth_header);
    headers = curl_slist_append(headers, "Content-Type: application/json");

    curl_easy_setopt(curl, CURLOPT_URL, "https://doctorassist.ai/api/hms/integration/system/take_appointment");
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, json_data);

    curl_easy_perform(curl);
    curl_easy_cleanup(curl);
}`,
    cpp: `void sendAppointment() {
    std::string token = refreshToken(currentToken);
    if(token.empty()) return;

    CURL* curl = curl_easy_init();
    if(!curl) return;

    const char* jsonData =
    "{"
        "\\"hospital_id\\":\\"YOUR_HOSPITAL_ID\\"," 
        "\\"doctor_id\\":\\"YOUR_DOCTOR_ID\\"," 
        "\\"patient_id\\":\\"YOUR_PATIENT_ID\\"," 
        "\\"date\\":\\"YYYY-MM-DD\\"," 
        "\\"scheduled_time\\":\\"HH:MM\\"," 
        "\\"visit_type\\":\\"new\\"," 
        "\\"appointment_id\\":\\"YOUR_APPOINTMENT_ID\\"," 
        "\\"chief_complaint\\":\\"Chief complaint\\""
    "}";

    struct curl_slist* headers = NULL;
    std::string authHeader = "Authorization: Bearer " + token;
    headers = curl_slist_append(headers, authHeader.c_str());
    headers = curl_slist_append(headers, "Content-Type: application/json");

    curl_easy_setopt(curl, CURLOPT_URL, "https://doctorassist.ai/api/hms/integration/system/take_appointment");
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, jsonData);

    curl_easy_perform(curl);
    curl_easy_cleanup(curl);
}`,
  };

  const reportsCodeExamples = {
    python: `def send_patient_report():
    token = refresh_token(currenttoken)
    if not token:
        return

    report_data = {
        "patient_id": "YOUR_PATIENT_ID",
        "hospital_id": "YOUR_HOSPITAL_ID",
        "doctor_id": "YOUR_DOCTOR_ID",
        "upload_mode": "document",
        "report_date": "YYYY-MM-DD",
        "reports": [
            {
                "appointment_id": "YOUR_APPOINTMENT_ID",
                "path": "YOUR_REPORT_PATH.pdf",
                "date": "YYYY-MM-DD",
                "appointment_date": None
            }
        ]
    }

    url = "https://doctorassist.ai/api/hms/integration/system/patient_upload_report"
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    response = requests.post(url, headers=headers, json=report_data)
    print(response.status_code, response.json())`,
    java: `public static void sendPatientReport() throws IOException {
    String token = TokenManager.refreshToken(TokenManager.currentToken);
    if(token == null || token.isEmpty()) return;

    URL url = new URL("https://doctorassist.ai/api/hms/integration/system/patient_upload_report");
    HttpURLConnection con = (HttpURLConnection) url.openConnection();
    con.setRequestMethod("POST");
    con.setRequestProperty("Authorization", "Bearer " + token);
    con.setRequestProperty("Content-Type", "application/json");
    con.setDoOutput(true);

    String jsonData = "{"
        + "\\"patient_id\\":\\"YOUR_PATIENT_ID\\"," 
        + "\\"hospital_id\\":\\"YOUR_HOSPITAL_ID\\"," 
        + "\\"doctor_id\\":\\"YOUR_DOCTOR_ID\\"," 
        + "\\"upload_mode\\":\\"document\\"," 
        + "\\"report_date\\":\\"YYYY-MM-DD\\"," 
        + "\\"reports\\":[{\\"appointment_id\\":\\"YOUR_APPOINTMENT_ID\\",\\"path\\":\\"report.pdf\\",\\"date\\":\\"YYYY-MM-DD\\",\\"appointment_date\\":null}]"
    + "}";

    try(OutputStream os = con.getOutputStream()) {
        os.write(jsonData.getBytes("utf-8"));
    }

    System.out.println(new BufferedReader(new InputStreamReader(con.getInputStream())).lines().collect(java.util.stream.Collectors.joining()));
}`,
    c: `void send_patient_report() {
    char *token = refresh_token(currenttoken);
    if(!token || strlen(token) == 0) return;

    CURL *curl = curl_easy_init();
    if(!curl) return;

    const char* json_data =
    "{"
        "\\"patient_id\\":\\"YOUR_PATIENT_ID\\"," 
        "\\"hospital_id\\":\\"YOUR_HOSPITAL_ID\\"," 
        "\\"doctor_id\\":\\"YOUR_DOCTOR_ID\\"," 
        "\\"upload_mode\\":\\"document\\"," 
        "\\"report_date\\":\\"YYYY-MM-DD\\"," 
        "\\"reports\\":[{\\"appointment_id\\":\\"YOUR_APPOINTMENT_ID\\",\\"path\\":\\"report.pdf\\",\\"date\\":\\"YYYY-MM-DD\\",\\"appointment_date\\":null}]"
    "}";

    struct curl_slist *headers = NULL;
    char auth_header[512];
    snprintf(auth_header, sizeof(auth_header), "Authorization: Bearer %s", token);
    headers = curl_slist_append(headers, auth_header);
    headers = curl_slist_append(headers, "Content-Type: application/json");

    curl_easy_setopt(curl, CURLOPT_URL, "https://doctorassist.ai/api/hms/integration/system/patient_upload_report");
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, json_data);

    curl_easy_perform(curl);
    curl_easy_cleanup(curl);
}`,
    cpp: `void sendPatientReport() {
    std::string token = refreshToken(currentToken);
    if(token.empty()) return;

    CURL* curl = curl_easy_init();
    if(!curl) return;

    const char* jsonData =
    "{"
        "\\"patient_id\\":\\"YOUR_PATIENT_ID\\"," 
        "\\"hospital_id\\":\\"YOUR_HOSPITAL_ID\\"," 
        "\\"doctor_id\\":\\"YOUR_DOCTOR_ID\\"," 
        "\\"upload_mode\\":\\"document\\"," 
        "\\"report_date\\":\\"YYYY-MM-DD\\"," 
        "\\"reports\\":[{\\"appointment_id\\":\\"YOUR_APPOINTMENT_ID\\",\\"path\\":\\"report.pdf\\",\\"date\\":\\"YYYY-MM-DD\\",\\"appointment_date\\":null}]"
    "}";

    struct curl_slist* headers = NULL;
    std::string authHeader = "Authorization: Bearer " + token;
    headers = curl_slist_append(headers, authHeader.c_str());
    headers = curl_slist_append(headers, "Content-Type: application/json");

    curl_easy_setopt(curl, CURLOPT_URL, "https://doctorassist.ai/api/hms/integration/system/patient_upload_report");
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, jsonData);

    curl_easy_perform(curl);
    curl_easy_cleanup(curl);
}`,
  };

  const labReportsCodeExamples = {
    python: `def send_patient_lab_reports():
    token = refresh_token(currenttoken)
    if not token:
        return

    lab_report_data = {
        "hospital_id": "YOUR_HOSPITAL_ID",
        "doctor_id": "YOUR_DOCTOR_ID",
        "patient_id": "YOUR_PATIENT_ID",
        "reports": [
            {
                "report_name": "Complete Blood Count",
                "report_date": "YYYY-MM-DD",
                "parameters": [
                    {
                        "name": "Hemoglobin",
                        "value": "13.5",
                        "high_range": "17.5",
                        "low_range": "13.0"
                    }
                ]
            }
        ]
    }

    url = "https://doctorassist.ai/api/hms/integration/system/add_patient_lab_reports"
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    response = requests.post(url, headers=headers, json=lab_report_data)
    print(response.status_code, response.json())`,
    java: `public static void sendPatientLabReports() throws IOException {
    String token = TokenManager.refreshToken(TokenManager.currentToken);
    if(token == null || token.isEmpty()) return;

    URL url = new URL("https://doctorassist.ai/api/hms/integration/system/add_patient_lab_reports");
    HttpURLConnection con = (HttpURLConnection) url.openConnection();
    con.setRequestMethod("POST");
    con.setRequestProperty("Authorization", "Bearer " + token);
    con.setRequestProperty("Content-Type", "application/json");
    con.setDoOutput(true);

    String jsonData = "{"
        + "\\"hospital_id\\":\\"YOUR_HOSPITAL_ID\\"," 
        + "\\"doctor_id\\":\\"YOUR_DOCTOR_ID\\"," 
        + "\\"patient_id\\":\\"YOUR_PATIENT_ID\\"," 
        + "\\"reports\\":[{\\"report_name\\":\\"Complete Blood Count\\",\\"report_date\\":\\"YYYY-MM-DD\\","
        + "\\"parameters\\":[{\\"name\\":\\"Hemoglobin\\",\\"value\\":\\"13.5\\",\\"high_range\\":\\"17.5\\",\\"low_range\\":\\"13.0\\"}]}]"
    + "}";

    try(OutputStream os = con.getOutputStream()) {
        os.write(jsonData.getBytes("utf-8"));
    }

    System.out.println(new BufferedReader(new InputStreamReader(con.getInputStream())).lines().collect(java.util.stream.Collectors.joining()));
}`,
    c: `void send_patient_lab_reports() {
    char *token = refresh_token(currenttoken);
    if(!token || strlen(token) == 0) return;

    CURL *curl = curl_easy_init();
    if(!curl) return;

    const char* json_data =
    "{"
        "\\"hospital_id\\":\\"YOUR_HOSPITAL_ID\\"," 
        "\\"doctor_id\\":\\"YOUR_DOCTOR_ID\\"," 
        "\\"patient_id\\":\\"YOUR_PATIENT_ID\\"," 
        "\\"reports\\":[{\\"report_name\\":\\"Complete Blood Count\\",\\"report_date\\":\\"YYYY-MM-DD\\","
        "\\"parameters\\":[{\\"name\\":\\"Hemoglobin\\",\\"value\\":\\"13.5\\",\\"high_range\\":\\"17.5\\",\\"low_range\\":\\"13.0\\"}]}]"
    "}";

    struct curl_slist *headers = NULL;
    char auth_header[512];
    snprintf(auth_header, sizeof(auth_header), "Authorization: Bearer %s", token);
    headers = curl_slist_append(headers, auth_header);
    headers = curl_slist_append(headers, "Content-Type: application/json");

    curl_easy_setopt(curl, CURLOPT_URL, "https://doctorassist.ai/api/hms/integration/system/add_patient_lab_reports");
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, json_data);
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, WriteMemoryCallback);

    curl_easy_perform(curl);
    curl_easy_cleanup(curl);
}`,
    cpp: `void sendPatientLabReports() {
    std::string token = refreshToken(currentToken);
    if(token.empty()) return;

    CURL* curl = curl_easy_init();
    if(!curl) return;

    const char* jsonData =
    "{"
        "\\"hospital_id\\":\\"YOUR_HOSPITAL_ID\\"," 
        "\\"doctor_id\\":\\"YOUR_DOCTOR_ID\\"," 
        "\\"patient_id\\":\\"YOUR_PATIENT_ID\\"," 
        "\\"reports\\":[{\\"report_name\\":\\"Complete Blood Count\\",\\"report_date\\":\\"YYYY-MM-DD\\","
        "\\"parameters\\":[{\\"name\\":\\"Hemoglobin\\",\\"value\\":\\"13.5\\",\\"high_range\\":\\"17.5\\",\\"low_range\\":\\"13.0\\"}]}]"
    "}";

    struct curl_slist* headers = NULL;
    std::string authHeader = "Authorization: Bearer " + token;
    headers = curl_slist_append(headers, authHeader.c_str());
    headers = curl_slist_append(headers, "Content-Type: application/json");

    curl_easy_setopt(curl, CURLOPT_URL, "https://doctorassist.ai/api/hms/integration/system/add_patient_lab_reports");
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, jsonData);

    curl_easy_perform(curl);
    curl_easy_cleanup(curl);
}`,
  };

  const visitHistoryCodeExamples = {
    python: `def send_patient_visit_history():
    token = refresh_token(currenttoken)
    if not token:
        return

    visit_history_data = {
        "hospital_id": "YOUR_HOSPITAL_ID",
        "doctor_id": "YOUR_DOCTOR_ID",
        "patient_id": "YOUR_PATIENT_ID",
        "visits": [
            {
                "visit_date": "YYYY-MM-DD",
                "visit_summary": "Summary of the patient visit",
                "presenting_complaint": "Patient's main complaint during visit",
                "duration_of_presenting_complaint": "3 days",
                "family_history": "Relevant family medical history",
                "medication_history": "Previous medication details",
                "recent_abnormal_values": [
                    {
                        "parameter": "Hemoglobin",
                        "value": "10.2",
                        "normal_range": "13.0-17.5"
                    }
                ],
                "primary_diagnosis": "Primary diagnosis identified during visit",
                "doctor_notes": "Doctor's clinical notes and recommendations",
                "investigations": [
                    {
                        "investigation_name": "Complete Blood Count",
                        "category": "Hematology",
                        "subcategory": "Routine",
                        "standard_indications": "Reason for performing investigation",
                        "sample_type": "Blood",
                        "fasting_required": "No",
                        "priority": "Routine",
                        "loinc_code": "58410-2"
                    }
                ],
                "procedures": [
                    "Name of procedures performed"
                ],
                "medication": [
                    {
                        "medication": "Medication name",
                        "generic_name": "Generic medication name",
                        "brand_name": "Brand name",
                        "category": "Medication category",
                        "strength": "500mg",
                        "dosage_form": "Tablet",
                        "route": "Oral",
                        "frequency": "Twice daily",
                        "follow_up": "Monitoring or follow-up instructions",
                        "standard_frequency_options": ["Once daily", "Twice daily"],
                        "standard_duration_options": ["5 days", "7 days"],
                        "special_instructions": "Special medication instructions",
                        "dosage_instructions": "How to take the medication",
                        "quantity": "10",
                        "refills": "1"
                    }
                ]
            }
        ]
    }

    url = "https://doctorassist.ai/api/hms/integration/system/add_patient_visit_history"
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    response = requests.post(url, headers=headers, json=visit_history_data)
    print(response.status_code, response.json())`,
    java: `public static void sendPatientVisitHistory() throws IOException {
    String token = TokenManager.refreshToken(TokenManager.currentToken);
    if(token == null || token.isEmpty()) return;

    URL url = new URL("https://doctorassist.ai/api/hms/integration/system/add_patient_visit_history");
    HttpURLConnection con = (HttpURLConnection) url.openConnection();
    con.setRequestMethod("POST");
    con.setRequestProperty("Authorization", "Bearer " + token);
    con.setRequestProperty("Content-Type", "application/json");
    con.setDoOutput(true);

    String jsonData = "{"
        + "\\"hospital_id\\":\\"YOUR_HOSPITAL_ID\\"," 
        + "\\"doctor_id\\":\\"YOUR_DOCTOR_ID\\"," 
        + "\\"patient_id\\":\\"YOUR_PATIENT_ID\\"," 
        + "\\"visits\\":[{\\"visit_date\\":\\"YYYY-MM-DD\\",\\"visit_summary\\":\\"Summary of visit\\","
        + "\\"presenting_complaint\\":\\"Main complaint\\",\\"primary_diagnosis\\":\\"Primary diagnosis\\","
        + "\\"doctor_notes\\":\\"Clinical notes\\",\\"investigations\\":[],\\"procedures\\":[],\\"medication\\":[]}]"
    + "}";

    try(OutputStream os = con.getOutputStream()) {
        os.write(jsonData.getBytes("utf-8"));
    }

    System.out.println(new BufferedReader(new InputStreamReader(con.getInputStream())).lines().collect(java.util.stream.Collectors.joining()));
}`,
    c: `void send_patient_visit_history() {
    char *token = refresh_token(currenttoken);
    if(!token || strlen(token) == 0) return;

    CURL *curl = curl_easy_init();
    if(!curl) return;

    const char* json_data =
    "{"
        "\\"hospital_id\\":\\"YOUR_HOSPITAL_ID\\"," 
        "\\"doctor_id\\":\\"YOUR_DOCTOR_ID\\"," 
        "\\"patient_id\\":\\"YOUR_PATIENT_ID\\"," 
        "\\"visits\\":[{\\"visit_date\\":\\"YYYY-MM-DD\\",\\"visit_summary\\":\\"Summary of visit\\","
        "\\"presenting_complaint\\":\\"Main complaint\\",\\"primary_diagnosis\\":\\"Primary diagnosis\\","
        "\\"doctor_notes\\":\\"Clinical notes\\",\\"investigations\\":[],\\"procedures\\":[],\\"medication\\":[]}]"
    "}";

    struct curl_slist *headers = NULL;
    char auth_header[512];
    snprintf(auth_header, sizeof(auth_header), "Authorization: Bearer %s", token);
    headers = curl_slist_append(headers, auth_header);
    headers = curl_slist_append(headers, "Content-Type: application/json");

    curl_easy_setopt(curl, CURLOPT_URL, "https://doctorassist.ai/api/hms/integration/system/add_patient_visit_history");
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, json_data);
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, WriteMemoryCallback);

    curl_easy_perform(curl);
    curl_easy_cleanup(curl);
}`,
    cpp: `void sendPatientVisitHistory() {
    std::string token = refreshToken(currentToken);
    if(token.empty()) return;

    CURL* curl = curl_easy_init();
    if(!curl) return;

    const char* jsonData =
    "{"
        "\\"hospital_id\\":\\"YOUR_HOSPITAL_ID\\"," 
        "\\"doctor_id\\":\\"YOUR_DOCTOR_ID\\"," 
        "\\"patient_id\\":\\"YOUR_PATIENT_ID\\"," 
        "\\"visits\\":[{\\"visit_date\\":\\"YYYY-MM-DD\\",\\"visit_summary\\":\\"Summary of visit\\","
        "\\"presenting_complaint\\":\\"Main complaint\\",\\"primary_diagnosis\\":\\"Primary diagnosis\\","
        "\\"doctor_notes\\":\\"Clinical notes\\",\\"investigations\\":[],\\"procedures\\":[],\\"medication\\":[]}]"
    "}";

    struct curl_slist* headers = NULL;
    std::string authHeader = "Authorization: Bearer " + token;
    headers = curl_slist_append(headers, authHeader.c_str());
    headers = curl_slist_append(headers, "Content-Type: application/json");

    curl_easy_setopt(curl, CURLOPT_URL, "https://doctorassist.ai/api/hms/integration/system/add_patient_visit_history");
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, jsonData);

    curl_easy_perform(curl);
    curl_easy_cleanup(curl);
}`,
  };

  const languageButtonStyle = (isActive) => ({
    padding: '6px 14px',
    fontSize: '0.7rem',
    fontWeight: isActive ? 400 : 300,
    fontFamily: "'Open Sans', sans-serif",
    background: isActive ? T.text : 'transparent',
    color: isActive ? T.bg : T.textSec,
    border: `1px solid ${isActive ? T.text : T.border}`,
    borderRadius: '2px',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  });

  const LanguageButtons = ({ activeLang, onLangChange }) => (
    <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
      {['python', 'java', 'c', 'cpp'].map((lang) => (
        <button key={lang} onClick={() => onLangChange(lang)} style={languageButtonStyle(activeLang === lang)}>
          {lang.toUpperCase()}
        </button>
      ))}
    </div>
  );

  // ─── Save Endpoint Config Component ───
  const SaveEndpointConfig = ({ tag, sampleOutput, documentationOutputs }) => (
  <div style={{ marginTop: '1.5rem' }}>
    <div style={{ height: '1px', background: T.border, margin: '0 0 1.5rem' }} />

    <h3 style={{ fontSize: '0.75rem', fontWeight: 400, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.5rem', color: T.textMuted }}>
      Return Output
    </h3>
    <div style={{ ...S.infoBox, marginBottom: '0.75rem' }}>
      When this widget completes, the following payload(s) are automatically POSTed to your configured save endpoint:
    </div>

    {documentationOutputs ? (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.5rem' }}>
        {documentationOutputs.map((output, i) => (
          <div key={i}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
              <span style={{ ...S.methodBadge, background: '#2a2a2a', color: '#fff', borderColor: '#2a2a2a', fontSize: '0.58rem' }}>
                {output.payload.tag}
              </span>
              <span style={{ fontSize: '0.78rem', fontWeight: 400, color: T.text }}>{output.title}</span>
            </div>
            <div style={{ position: 'relative' }}>
              <button
                onClick={() => copyToClipboard(JSON.stringify(output.payload, null, 2), `copy-${tag}-${i}`)}
                style={S.copyBtn}
              >
                {copiedText === `copy-${tag}-${i}` ? '✓ Copied' : 'Copy'}
              </button>
              <pre style={S.codeBlock}>
                <code>{JSON.stringify(output.payload, null, 2)}</code>
              </pre>
            </div>
          </div>
        ))}
      </div>
    ) : (
      <div style={{ position: 'relative', marginBottom: '1.5rem' }}>
        <button
          onClick={() => copyToClipboard(JSON.stringify(sampleOutput, null, 2), `copy-${tag}`)}
          style={S.copyBtn}
        >
          {copiedText === `copy-${tag}` ? '✓ Copied' : 'Copy'}
        </button>
        <pre style={S.codeBlock}>
          <code>{JSON.stringify(sampleOutput, null, 2)}</code>
        </pre>
      </div>
    )}

    {/* Save Endpoint Config */}
    <h3 style={{ fontSize: '0.75rem', fontWeight: 400, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.5rem', color: T.textMuted }}>
      Save Endpoint Configuration
    </h3>
    <div style={{ ...S.warningBox, marginBottom: '0.75rem' }}>
      Configure your endpoint below. DoctorAssist will automatically POST the return payload shown above to your configured endpoint URL after the widget completes. Follow the steps below to set up your Save Endpoint and return the widget output to your HMS.
    </div>

    {/* Step 1 */}
    <div style={{ marginBottom: '1.5rem' }}>
      <h4 style={{ marginBottom: '8px', fontSize: '0.85rem', fontWeight: 500 }}>Step 1: Login to DoctorAssist</h4>
      <p style={{ fontSize: '0.75rem', color: T.textSec, marginBottom: '12px' }}>Enter your hospital username and password and log in to the DoctorAssist portal.</p>
      <div style={S.infoBox}>https://doctorassist.ai/login</div>
    </div>

    {/* Step 2 */}
    <div style={{ marginBottom: '1.5rem' }}>
      <h4 style={{ marginBottom: '8px', fontSize: '0.85rem', fontWeight: 500 }}>Step 2: Open Integration Settings</h4>
      <p style={{ fontSize: '0.75rem', color: T.textSec, marginBottom: '12px' }}>
        After logging in, click on the <strong>Integration Settings</strong> tab from the sidebar menu.
      </p>
      <img src={SaveEndpointStepImg} alt="Integration Settings" style={{ width: '100%', border: `1px solid ${T.border}`, borderRadius: '4px' }} />
    </div>

    {/* Step 3 */}
    <div style={{ marginBottom: '1.5rem' }}>
      <h4 style={{ marginBottom: '8px', fontSize: '0.85rem', fontWeight: 500 }}>Step 3: Configure Save Endpoint</h4>
      <p style={{ fontSize: '0.75rem', color: T.textSec, marginBottom: '12px' }}>
        Enter your HMS Save Endpoint URL in the Save Endpoint field and click the <strong> Save Endpoint </strong> button to save the configuration.
      </p>
      <img src={SaveEndpoint} alt="Save Endpoint Configuration" style={{ width: '100%', border: `1px solid ${T.border}`, borderRadius: '4px' }} />
    </div>

    {/* How it works */}
    <h3 style={{ fontSize: '0.75rem', fontWeight: 400, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.75rem', color: T.textMuted }}>
      How It Works
    </h3>
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {[
        { step: 1, title: 'Widget completes', desc: 'User interacts with the widget and output is generated on the DoctorAssist platform.' },
        { step: 2, title: 'Payload assembled', desc: `tag: "${tag}", patient_id, doctor_id, and the widget output are bundled into a single JSON object.` },
        { step: 3, title: 'POST to your endpoint', desc: 'DoctorAssist sends the payload to your configured save endpoint via HTTP POST automatically.' },
        { step: 4, title: 'Your system receives it', desc: 'Handle the incoming JSON in your HMS to store, display, or process the widget result.' },
      ].map(item => (
        <div key={item.step} style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
          <span style={S.stepBadge}>{item.step}</span>
          <div>
            <p style={{ margin: '0 0 2px', fontSize: '0.8rem', fontWeight: 400, color: T.text }}>{item.title}</p>
            <p style={{ margin: 0, fontSize: '0.72rem', color: T.textSec, lineHeight: 1.5 }}>{item.desc}</p>
          </div>
        </div>
      ))}
    </div>
  </div>
);
  // ─── Request/Response Examples ───
  const demographicsExample = `{
  "hospital_id": "YOUR_HOSPITAL_ID",
  "hms_patient_id": "YOUR_PATIENT_ID",
  "demographics": {
    "name": "Patient Name",
    "dob": "YYYY-MM-DD",
    "sex": "M/F",
    "phone": "+1234567890",
    "mrn": "MRN_NUMBER",
    "email": "patient@example.com",
    "blood_group": "A+",
    "marital_status": "Single/Married",
    "address": "Patient Address",
    "occupation": "Occupation",
    "education": "Education Level",
    "family_history": "Family History"
  },
  "insurance_profile": {
    "payer_scheme": "Scheme Name",
    "country": "Country",
    "primary": {
      "payer_name": "Insurance Provider",
      "payer_code": "PROVIDER_CODE",
      "policy_number": "POLICY_NUMBER",
      "member_id": "MEMBER_ID",
      "coverage_plan": "Plan Name",
      "valid_from": "YYYY-MM-DD",
      "valid_to": "YYYY-MM-DD",
      "relationship_to_insured": "Self/Spouse/Child",
      "co_pay_percent": 20,
      "deductible_amount": 50.00,
      "max_annual_limit": 500000.0,
      "exclusions": ["Exclusion 1"],
      "consents": {
        "insurance_data_share": true,
        "claim_submission": true
      }
    },
    "secondary": null
  }
}`;

  const vitalsExample = `{
  "hospital_id": "YOUR_HOSPITAL_ID",
  "doctor_id": "YOUR_DOCTOR_ID",
  "patient_id": "YOUR_PATIENT_ID",
  "appointment_id": "YOUR_APPOINTMENT_ID",
  "vitals": {
    "2026-01-25T10:30:00": {
      "bp": "120/80",
      "pulse": 72,
      "temperature": 98.6,
      "respiratory_rate": 16,
      "spo2": 99,
      "weight": 68,
      "height": 172
    }
  }
}`;

  const reportsExample = `{
  "patient_id": "YOUR_PATIENT_ID",
  "hospital_id": "YOUR_HOSPITAL_ID",
  "doctor_id": "YOUR_DOCTOR_ID",
  "upload_mode": "document",
  "report_date": "YYYY-MM-DD",
  "reports": [
    {
      "appointment_id": "YOUR_APPOINTMENT_ID",
      "document_id": "YOUR_DOCUMENT_ID",
      "path": "YOUR_REPORT_PATH.pdf",
      "date": "YYYY-MM-DD",
      "appointment_date": null
    }
  ]
}`;

  const labReportsExample = `{
  "hospital_id": "YOUR_HOSPITAL_ID",
  "doctor_id": "YOUR_DOCTOR_ID",
  "patient_id": "YOUR_PATIENT_ID",
  "reports": [
    {
      "report_name": "Complete Blood Count",
      "report_date": "YYYY-MM-DD",
      "parameters": [
        {
          "name": "Hemoglobin",
          "value": "13.5",
          "high_range": "17.5",
          "low_range": "13.0"
        }
      ]
    }
  ]
}`;

  const visitHistoryExample = `{
  "hospital_id": "YOUR_HOSPITAL_ID",
  "doctor_id": "YOUR_DOCTOR_ID",
  "patient_id": "YOUR_PATIENT_ID",
  "visits": [
    {
      "visit_date": "YYYY-MM-DD",
      "visit_summary": "Summary of the patient visit",
      "presenting_complaint": "Patient's main complaint during visit",
      "duration_of_presenting_complaint": "Duration of the complaint",
      "family_history": "Relevant family medical history",
      "medication_history": "Previous medication details",
      "recent_abnormal_values": [
        {
          "parameter": "Name of abnormal parameter",
          "value": "Observed value",
          "normal_range": "Normal reference range"
        }
      ],
      "primary_diagnosis": "Primary diagnosis identified during visit",
      "doctor_notes": "Doctor's clinical notes and recommendations",
      "investigations": [
        {
          "investigation_name": "Name of investigation",
          "category": "Investigation category",
          "subcategory": "Investigation subcategory",
          "standard_indications": "Reason for performing investigation",
          "sample_type": "Sample required for investigation",
          "fasting_required": "Fasting requirement",
          "priority": "Priority of investigation",
          "loinc_code": "LOINC code if available"
        }
      ],
      "procedures": [
        "Name of procedure performed"
      ],
      "medication": [
        {
          "medication": "Medication name",
          "generic_name": "Generic medication name",
          "brand_name": "Brand name",
          "category": "Medication category",
          "strength": "Medication strength",
          "dosage_form": "Dosage form",
          "route": "Administration route",
          "frequency": "Frequency of medication",
          "follow_up": "Monitoring or follow-up instructions",
          "standard_frequency_options": [
            "Available frequency options"
          ],
          "standard_duration_options": [
            "Available duration options"
          ],
          "special_instructions": "Special medication instructions",
          "dosage_instructions": "How to take the medication",
          "quantity": "Quantity prescribed",
          "refills": "Number of refills"
        }
      ]
    }
  ]
}`;

  const validationPayload = `{
  "hospital_id": "YOUR_HOSPITAL_ID",
  "doctor_id": "YOUR_DOCTOR_ID",
  "patient_id": "YOUR_PATIENT_ID"
}`;

  const validationResponse = `{
  "doctor": {
    "doctor_sys_user_id": "SYS_DOCTOR_ID"
  },
  "patient": {
    "patient_sys_user_id": "SYS_PATIENT_ID"
  }
}`;

  const globalDataCode = `window.DOCTOR_ASSIST_DATA = {
  transcript: "",
  diagnosis: "",
  treatment_plan: "",
  document_treatment_plan: "",
  medications: [],
  investigations: [],
  clinical_notes: "",
  onboarding_summary: ""
};`;

  const fullHtmlExample = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>DoctorAssist Widgets Demo</title>
</head>
<body>
  <div id="patient-widget"></div>
  <div id="transcription-widget"></div>
  <div id="diagnosis-widget"></div>
  <div id="treatmentplan-widget"></div>
  <div id="combined-documentation-widget"></div>
  <div id="report-upload-widget"></div>
 

  <script>
    window.process = { env: {} };
    window.PATIENT_WIDGET_API = "https://doctorassist.ai/api/";
    window.DOCTOR_ASSIST_DATA = {
      transcript: "", diagnosis: "", treatment_plan: "",
      document_treatment_plan: "", medications: [],
      investigations: [], clinical_notes: "", onboarding_summary: ""
    };
  </script>

  <script src="https://doctorassist.ai/widgets/patient-widget.js?V=1"></script>
  <script src="https://doctorassist.ai/widgets/transcription-widget.js?V=1"></script>
  <script src="https://doctorassist.ai/widgets/diagnosis-widget.js?V=1"></script>
  <script src="https://doctorassist.ai/widgets/treatmentplan-widget.js?V=1"></script>
  <script src="https://doctorassist.ai/widgets/combined-documentation-widget.js?V=1"></script>
  <script src="https://doctorassist.ai/widgets/report-upload-widget.js?V=1"></script>
  

  <script>
    window.addEventListener("load", async function () {
      const endpoint = "https://doctorassist.ai/api/hms/integration/system/validate-widget-session";
      const bearerToken = "YOUR_BEARER_TOKEN";
      const payload = {
        hospital_id: "YOUR_HOSPITAL_ID",
        doctor_id: "YOUR_DOCTOR_ID",
        patient_id: "YOUR_PATIENT_ID"
      };

      async function validateSession() {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: \`Bearer \${bearerToken}\` },
          body: JSON.stringify(payload)
        });
        if (!response.ok) throw new Error(\`Validation failed: \${response.status}\`);
        return await response.json();
      }

      try { const d = await validateSession(); window.PatientWidget?.init({ containerId: "patient-widget", patientId: d.patient.patient_sys_user_id, doctorId: d.doctor.doctor_sys_user_id }); } catch(e) {}
      try { const d = await validateSession(); window.TranscriptionWidget?.init({ containerId: "transcription-widget", doctorId: d.doctor.doctor_sys_user_id, patientId: d.patient.patient_sys_user_id }); } catch(e) {}
      try { const d = await validateSession(); window.DiagnosisWidget?.init({ containerId: "diagnosis-widget", doctorId: d.doctor.doctor_sys_user_id, patientId: d.patient.patient_sys_user_id }); } catch(e) {}
      try { const d = await validateSession(); window.TreatmentPlanWidget?.init({ containerId: "treatmentplan-widget", doctorId: d.doctor.doctor_sys_user_id, patientId: d.patient.patient_sys_user_id }); } catch(e) {}
      try { const d = await validateSession(); window.CombinedDocumentationWidget?.init({ containerId: "combined-documentation-widget", doctorId: d.doctor.doctor_sys_user_id, patientId: d.patient.patient_sys_user_id }); } catch(e) {}
      try { const d = await validateSession(); window.ReportUploadWidget?.init({ containerId: "report-upload-widget", doctorId: d.doctor.doctor_sys_user_id, patientId: d.patient.patient_sys_user_id, appointmentId: d.appointment?.appointment_id }); } catch(e) {}
      });
  </script>
</body>
</html>`;

  // ─── Widget definitions ───
  const widgets = [
    {
      id: 'w-patient',
      label: 'Patient Summary',
      globalName: 'PatientWidget',
      containerId: 'patient-widget',
      scriptSrc: 'https://doctorassist.ai/widgets/patient-widget.js?V=1',
      videoSrc: 'https://doctorassist.ai/api/hms/users/data/whatsapp/view/patientsummary_new copy.webm',
      description: 'Displays a comprehensive summary of patient information including demographics, medical history, and active conditions.',
      params: [
        { name: 'containerId', required: true, desc: 'DOM element ID to mount the widget into' },
        { name: 'doctorId', required: true, desc: 'Resolved doctor sys user ID from session validation' },
        { name: 'patientId', required: true, desc: 'Resolved patient sys user ID from session validation response' },
      ],
      initCode: `window.PatientWidget?.init({
  containerId: "patient-widget",
  patientId: data.patient.patient_sys_user_id,
  doctorId: data.doctor.doctor_sys_user_id
});`,
      tag: 'patientsummary',
      sampleOutput: {
        tag: 'patientsummary',
        patient_id: 'actual_patient_id',
        doctor_id: 'actual_doctor_id',
        data: {
          patient_name: 'John Doe',
          age: 45,
          blood_group: 'A+',
          conditions: ['Hypertension', 'Type 2 Diabetes'],
          allergies: ['Penicillin'],
          current_medications: ['Metformin 500mg', 'Amlodipine 5mg'],
        },
      },
    },
    {
      id: 'w-transcription',
      label: 'Transcription',
      globalName: 'TranscriptionWidget',
      containerId: 'transcription-widget',
      scriptSrc: 'https://doctorassist.ai/widgets/transcription-widget.js?V=1',
      videoSrc: 'https://doctorassist.ai/api/hms/users/data/whatsapp/view/doctordictation.webm',
      description: 'Real-time audio transcription widget for doctor-patient consultations. Writes output to window.DOCTOR_ASSIST_DATA.transcript.',
      params: [
        { name: 'containerId', required: true, desc: 'DOM element ID to mount the widget into' },
        { name: 'doctorId', required: true, desc: 'Resolved doctor sys user ID from session validation' },
        { name: 'patientId', required: true, desc: 'Resolved patient sys user ID from session validation' },
      ],
      initCode: `window.TranscriptionWidget?.init({
  containerId: "transcription-widget",
  doctorId: data.doctor.doctor_sys_user_id,
  patientId: data.patient.patient_sys_user_id
});`,
      tag: 'transcription',
      sampleOutput: {
        tag: 'transcription',
        patient_id: 'actual_patient_id',
        doctor_id: 'actual_doctor_id',
        data: {
          transcript: 'Doctor: How are you feeling today? Patient: I have been experiencing chest pain for the past two days and some shortness of breath.',
        },
      },
    },
    {
      id: 'w-diagnosis',
      label: 'Diagnosis',
      globalName: 'DiagnosisWidget',
      containerId: 'diagnosis-widget',
      scriptSrc: 'https://doctorassist.ai/widgets/diagnosis-widget.js?V=1',
      videoSrc: 'https://doctorassist.ai/api/hms/users/data/whatsapp/view/dignosisanalysis.webm',
      description: 'AI-assisted diagnosis widget that analyses the transcript and patient context to suggest differential diagnoses. Writes to window.DOCTOR_ASSIST_DATA.diagnosis.',
      params: [
        { name: 'containerId', required: true, desc: 'DOM element ID to mount the widget into' },
        { name: 'doctorId', required: true, desc: 'Resolved doctor sys user ID from session validation' },
        { name: 'patientId', required: true, desc: 'Resolved patient sys user ID from session validation' },
      ],
      initCode: `window.DiagnosisWidget?.init({
  containerId: "diagnosis-widget",
  doctorId: data.doctor.doctor_sys_user_id,
  patientId: data.patient.patient_sys_user_id
});`,
      tag: 'diagnosis',
      sampleOutput: {
        tag: 'diagnosis',
        patient_id: 'actual_patient_id',
        doctor_id: 'actual_doctor_id',
        data: {
          primary_diagnosis: 'Hypertensive Heart Disease',
          differential_diagnoses: ['Coronary Artery Disease', 'Aortic Stenosis', 'Heart Failure'],
          confidence: 'high',
          icd_code: 'I11.9',
        },
      },
    },
    {
      id: 'w-treatmentplan',
      label: 'Treatment Plan',
      globalName: 'TreatmentPlanWidget',
      containerId: 'treatmentplan-widget',
      scriptSrc: 'https://doctorassist.ai/widgets/treatmentplan-widget.js?V=1',
      videoSrc: 'https://doctorassist.ai/api/hms/users/data/whatsapp/view/Treatmentplan.webm',
      description: 'Generates and displays structured treatment plans based on diagnosis. Populates window.DOCTOR_ASSIST_DATA.treatment_plan and document_treatment_plan.',
      params: [
        { name: 'containerId', required: true, desc: 'DOM element ID to mount the widget into' },
        { name: 'doctorId', required: true, desc: 'Resolved doctor sys user ID from session validation' },
        { name: 'patientId', required: true, desc: 'Resolved patient sys user ID from session validation' },
      ],
      initCode: `window.TreatmentPlanWidget?.init({
  containerId: "treatmentplan-widget",
  doctorId: data.doctor.doctor_sys_user_id,
  patientId: data.patient.patient_sys_user_id
});`,
      tag: 'treatmentplan',
      sampleOutput: {
        tag: 'treatmentplan',
        patient_id: 'actual_patient_id',
        doctor_id: 'actual_doctor_id',
        data: {
          treatment_plan: '1. Lifestyle modification — low sodium diet, 30 min daily exercise. 2. Medication review in 2 weeks.',
          medications: ['Amlodipine 5mg OD', 'Metformin 500mg BD'],
          follow_up: '2 weeks',
          investigations_ordered: ['ECG', 'Echocardiogram'],
        },
      },
    },
    {
      id: 'w-combined',
      label: 'Combined Documentation',
      globalName: 'CombinedDocumentationWidget',
      containerId: 'combined-documentation-widget',
      scriptSrc: 'https://doctorassist.ai/widgets/combined-documentation-widget.js?V=1',
      videoSrc: 'https://doctorassist.ai/api/hms/users/data/whatsapp/view/documentation.webm',
      description: 'Aggregates all session outputs (clinical notes, medications, investigations) into a single exportable documentation view. Reads from window.DOCTOR_ASSIST_DATA.',
      params: [
        { name: 'containerId', required: true, desc: 'DOM element ID to mount the widget into' },
        { name: 'doctorId', required: true, desc: 'Resolved doctor sys user ID from session validation' },
        { name: 'patientId', required: true, desc: 'Resolved patient sys user ID from session validation' },
      ],
      initCode: `window.CombinedDocumentationWidget?.init({
  containerId: "combined-documentation-widget",
  doctorId: data.doctor.doctor_sys_user_id,
  patientId: data.patient.patient_sys_user_id
});`,
      tag: 'combineddocumentation',
documentationOutputs: [
  {
    title: 'Clinical Notes',
    payload: {
      tag: 'documentation-clinical-notes',
      patient_id: 'actual_patient_id',
      doctor_id: 'actual_doctor_id',
      data: { clinical_notes: 'Patient presents with chest pain and shortness of breath. BP 150/95. Assessment: Hypertensive Heart Disease.' },
    },
  },
  {
    title: 'Medication Analysis',
    payload: {
      tag: 'documentation-medication-analysis',
      patient_id: 'actual_patient_id',
      doctor_id: 'actual_doctor_id',
      data: { medications: ['Amlodipine 5mg OD'] },
    },
  },
  {
    title: 'Investigation Notes',
    payload: {
      tag: 'documentation-investigation-notes',
      patient_id: 'actual_patient_id',
      doctor_id: 'actual_doctor_id',
      data: { investigations: ['ECG', 'Echocardiogram'] },
    },
  },
  {
    title: 'Treatment Plan',
    payload: {
      tag: 'documentation-treatment-plan',
      patient_id: 'actual_patient_id',
      doctor_id: 'actual_doctor_id',
      data: { treatment_plan: 'Lifestyle modification and medication review in 2 weeks.' },
    },
  },
],
    },
    {
      id: 'w-reportupload',
      label: 'Report Upload',
      globalName: 'ReportUploadWidget',
      containerId: 'report-upload-widget',
      scriptSrc: 'https://doctorassist.ai/widgets/report-upload-widget.js?V=1',
      videoSrc: 'https://doctorassist.ai/api/hms/users/data/whatsapp/view/reportupload.webm',
      description: 'Uploads patient reports, lab results, imaging studies, and clinical documents to the DoctorAssist platform for AI-powered analysis and integration into the patient record.',
      params: [
        { name: 'containerId', required: true, desc: 'DOM element ID to mount the widget into' },
        { name: 'doctorId', required: true, desc: 'Resolved doctor sys user ID from session validation' },
        { name: 'patientId', required: true, desc: 'Resolved patient sys user ID from session validation' },
        { name: 'appointmentId', required: true, desc: 'Resolved appointment_id from session validation' },
      ],
      initCode: `window.ReportUploadWidget?.init({
  containerId: "report-upload-widget",
  doctorId: data.doctor.doctor_sys_user_id,
  patientId: data.patient.patient_sys_user_id,
  appointmentId: data.appointment?.appointment_id
});`,
      tag: 'reportupload',
      sampleOutput: {
        tag: 'processed_document',
        patient_id: 'actual_patient_id',
        doctor_id: 'actual_doctor_id',
        data: {
          uploaded_files: [
            { name: 'blood_report.pdf', date: '2026-01-25', type: 'laboratory' },
            { name: 'chest_xray.jpg', date: '2026-01-25', type: 'imaging' },
          ],
        },
      },
    },
    {
      id: 'w-save',
      label: 'Save Session',
      globalName: 'SaveSessionWidget',
      containerId: 'save-session-widget',
      scriptSrc: 'https://doctorassist.ai/widgets/save-session-widget.js?V=1',
      videoSrc: 'https://doctorassist.ai/api/hms/users/data/whatsapp/view/save.webm',
      description: 'Persists the entire consultation session to the DoctorAssist backend. Should be the last widget initialized. Reads all fields from window.DOCTOR_ASSIST_DATA.',
      params: [
        { name: 'containerId', required: true, desc: 'DOM element ID to mount the widget into' },
        { name: 'doctorId', required: true, desc: 'Resolved doctor sys user ID from session validation' },
        { name: 'patientId', required: true, desc: 'Resolved patient sys user ID from session validation' },
      ],
      initCode: `window.SaveSessionWidget?.init({
  containerId: "save-session-widget",
  doctorId: data.doctor.doctor_sys_user_id,
  patientId: data.patient.patient_sys_user_id
});`,
      tag: 'savesession',
      sampleOutput: {
        tag: 'savesession',
        patient_id: 'actual_patient_id',
        doctor_id: 'actual_doctor_id',
        data: {
          session_id: 'SESSION_ID_ABC123',
          saved_at: '2026-01-25T10:30:00',
          status: 'completed',
          summary: 'Full consultation session saved successfully.',
        },
      },
    },
  ];

  const renderWidgetContent = () => {
    if (widgetSubSection === 'overview') {
      return (
        <div>
          <div style={{ marginBottom: '1.5rem' }}>
            <h1 style={{ fontSize: '1.4rem', fontWeight: 300, letterSpacing: '-0.02em', marginBottom: '0.75rem' }}>Widget Integration Overview</h1>
            <p style={{ fontSize: '0.85rem', color: T.textSec, lineHeight: 1.6, marginBottom: '1rem' }}>
              DoctorAssist provides a suite of embeddable JavaScript widgets that integrate directly into your HMS or EHR interface. Each widget is a self-contained UI component that communicates with the DoctorAssist backend using validated sessions.
            </p>
            <div style={S.infoBox}>
              <strong>Base URL:</strong> <code>https://doctorassist.ai</code><br />
              <strong>Widget CDN:</strong> <code>https://doctorassist.ai/widgets/</code><br />
              <strong>API Base:</strong> <code>https://doctorassist.ai/api/</code>
            </div>
          </div>

          <h3 style={{ fontSize: '0.75rem', fontWeight: 400, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.75rem', color: T.textMuted }}>Available Widgets</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1.5rem' }}>
            {[
              { id: 'w-patient', name: 'Patient Summary', desc: 'Demographics & medical history', script: 'patient-widget.js?V=1' },
              { id: 'w-transcription', name: 'Transcription', desc: 'Real-time audio transcription', script: 'transcription-widget.js?V=1' },
              { id: 'w-diagnosis', name: 'Diagnosis', desc: 'AI-assisted differential diagnosis', script: 'diagnosis-widget.js?V=1' },
              { id: 'w-treatmentplan', name: 'Treatment Plan', desc: 'Structured clinical treatment plan', script: 'treatmentplan-widget.js?V=1' },
              { id: 'w-combined', name: 'Combined Documentation', desc: 'Unified exportable session docs', script: 'combined-documentation-widget.js?V=1' },
              { id: 'w-reportupload', name: 'Report Upload', desc: 'Upload patient reports & lab results', script: 'report-upload-widget.js?V=1' },
              
            ].map((w, i) => (
              <div
                key={i}
                style={{ ...S.widgetCard, cursor: 'pointer', transition: 'border-color 0.2s, box-shadow 0.2s' }}
                onClick={() => setWidgetSubSection(w.id)}
                onMouseEnter={e => { e.currentTarget.style.borderColor = T.text; e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.boxShadow = 'none'; }}
              >
                <p style={S.widgetCardTitle}>{w.name}</p>
                <p style={S.widgetCardSub}>{w.desc}</p>
                <code style={{ fontSize: '0.65rem', color: T.textMuted }}>{w.script}</code>
              </div>
            ))}
          </div>

          <h3 style={{ fontSize: '0.75rem', fontWeight: 400, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.75rem', color: T.textMuted }}>Integration Flow</h3>
          {[
            { step: 1, title: 'Obtain Bearer Token', desc: 'Use the Authentication API to get an access token with your client_id and client_secret.' },
            { step: 2, title: 'Set global variables', desc: 'Define window.PATIENT_WIDGET_API and window.DOCTOR_ASSIST_DATA before loading widget scripts.' },
            { step: 3, title: 'Load widget scripts', desc: 'Add <script> tags for each widget you need from the CDN.' },
            { step: 4, title: 'Validate session', desc: 'Call the validate-widget-session endpoint with hospital_id, doctor_id, and patient_id.' },
            { step: 5, title: 'Initialize widgets', desc: 'Call Widget?.init() with the resolved sys IDs from the validation response.' },
          ].map((item) => (
            <div key={item.step} style={{ display: 'flex', gap: '12px', marginBottom: '0.875rem', alignItems: 'flex-start' }}>
              <span style={S.stepBadge}>{item.step}</span>
              <div>
                <p style={{ margin: '0 0 2px', fontSize: '0.8rem', fontWeight: 400, color: T.text }}>{item.title}</p>
                <p style={{ margin: 0, fontSize: '0.72rem', color: T.textSec, lineHeight: 1.5 }}>{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      );
    }

    if (widgetSubSection === 'setup') {
      return (
        <div>
          <div style={{ marginBottom: '1.5rem' }}>
            <h1 style={{ fontSize: '1.4rem', fontWeight: 300, letterSpacing: '-0.02em', marginBottom: '0.75rem' }}>Setup & Installation</h1>
            <p style={{ fontSize: '0.85rem', color: T.textSec, lineHeight: 1.6 }}>
              Widgets are loaded as plain JavaScript files — no build step or package manager required. Include them in any HTML page.
            </p>
          </div>

          <div style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ fontSize: '0.75rem', fontWeight: 400, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.75rem', color: T.textMuted }}>Step 1 — Set global config before widget scripts</h3>
            <div style={{ position: 'relative' }}>
              <button onClick={() => copyToClipboard(globalDataCode, 'globalconfig')} style={S.copyBtn}>{copiedText === 'globalconfig' ? '✓ Copied' : 'Copy'}</button>
              <pre style={S.codeBlock}><code>{`<script>
  window.process = { env: {} };
  window.PATIENT_WIDGET_API = "https://doctorassist.ai/api/";

  window.DOCTOR_ASSIST_DATA = {
    transcript: "",
    diagnosis: "",
    treatment_plan: "",
    document_treatment_plan: "",
    medications: [],
    investigations: [],
    clinical_notes: "",
    onboarding_summary: ""
  };
</script>`}</code></pre>
            </div>
          </div>

          <div style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ fontSize: '0.75rem', fontWeight: 400, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.75rem', color: T.textMuted }}>Step 2 — Add widget script tags</h3>
            <div style={{ position: 'relative' }}>
              <button onClick={() => copyToClipboard(
                `<script src="https://doctorassist.ai/widgets/patient-widget.js?V=1"></script>\n<script src="https://doctorassist.ai/widgets/transcription-widget.js?V=1"></script>\n<script src="https://doctorassist.ai/widgets/diagnosis-widget.js?V=1"></script>\n<script src="https://doctorassist.ai/widgets/treatmentplan-widget.js?V=1"></script>\n<script src="https://doctorassist.ai/widgets/combined-documentation-widget.js?V=1"></script>\n<script src="https://doctorassist.ai/widgets/report-upload-widget.js?V=1"></script>`,
                'scripts'
              )} style={S.copyBtn}>{copiedText === 'scripts' ? '✓ Copied' : 'Copy'}</button>
              <pre style={S.codeBlock}><code>{`<script src="https://doctorassist.ai/widgets/patient-widget.js?V=1"></script>
<script src="https://doctorassist.ai/widgets/transcription-widget.js?V=1"></script>
<script src="https://doctorassist.ai/widgets/diagnosis-widget.js?V=1"></script>
<script src="https://doctorassist.ai/widgets/treatmentplan-widget.js?V=1"></script>
<script src="https://doctorassist.ai/widgets/combined-documentation-widget.js?V=1"></script>
<script src="https://doctorassist.ai/widgets/report-upload-widget.js?V=1"></script>
`}</code></pre>
            </div>
          </div>

          <div style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ fontSize: '0.75rem', fontWeight: 400, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.75rem', color: T.textMuted }}>Step 3 — Add container elements</h3>
            <div style={{ position: 'relative' }}>
              <pre style={S.codeBlock}><code>{`<div id="patient-widget"></div>
<div id="transcription-widget"></div>
<div id="diagnosis-widget"></div>
<div id="treatmentplan-widget"></div>
<div id="combined-documentation-widget"></div>
<div id="report-upload-widget"></div>
`}</code></pre>
            </div>
          </div>

          <div style={S.warningBox}>
            <strong>Important:</strong> All widgets must be initialized inside a <code>window.addEventListener("load", ...)</code> callback to ensure all scripts are loaded before <code>init()</code> is called.
          </div>
        </div>
      );
    }

    if (widgetSubSection === 'validation') {
      return (
        <div>
          <div style={{ marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px', flexWrap: 'wrap' }}>
              <span style={{ ...S.methodBadge, ...S.methodBadgePost }}>POST</span>
              <code style={{ fontSize: '0.78rem', color: T.textSec, background: T.bgAlt, padding: '4px 8px', borderRadius: '2px' }}>https://doctorassist.ai/api/hms/integration/system/validate-widget-session</code>
            </div>
            <h1 style={{ fontSize: '1.4rem', fontWeight: 300, letterSpacing: '-0.02em', marginBottom: '0.75rem' }}>Session Validation</h1>
            <p style={{ fontSize: '0.85rem', color: T.textSec, lineHeight: 1.6 }}>
              Before initializing any widget, validate the session to resolve the internal system IDs for the doctor and patient.
            </p>
          </div>

          <div style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ fontSize: '0.75rem', fontWeight: 400, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.75rem', color: T.textMuted }}>Request Body</h3>
            <div style={{ position: 'relative' }}>
              <button onClick={() => copyToClipboard(validationPayload, 'valPayload')} style={S.copyBtn}>{copiedText === 'valPayload' ? '✓ Copied' : 'Copy'}</button>
              <pre style={S.codeBlock}><code>{validationPayload}</code></pre>
            </div>
          </div>

          <div style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ fontSize: '0.75rem', fontWeight: 400, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.75rem', color: T.textMuted }}>Response</h3>
            <div style={{ background: T.bgAlt, padding: '1rem', border: `1px solid ${T.border}`, borderRadius: '4px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <span style={{ ...S.methodBadge, background: T.text, color: T.bg }}>200</span>
                <span style={{ fontSize: '0.75rem', fontWeight: 400 }}>✓ Success</span>
              </div>
              <pre style={{ margin: 0, fontSize: '0.72rem', fontFamily: 'monospace' }}>{validationResponse}</pre>
            </div>
          </div>

          <div style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ fontSize: '0.75rem', fontWeight: 400, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.75rem', color: T.textMuted }}>Example Usage (JavaScript)</h3>
            <div style={{ position: 'relative' }}>
              <button onClick={() => copyToClipboard(`async function validateSession() {\n  const response = await fetch("https://doctorassist.ai/api/hms/integration/system/validate-widget-session", {\n    method: "POST",\n    headers: { "Content-Type": "application/json", Authorization: \`Bearer \${bearerToken}\` },\n    body: JSON.stringify({ hospital_id, doctor_id, patient_id })\n  });\n  if (!response.ok) throw new Error(\`Validation failed: \${response.status}\`);\n  return await response.json();\n}`, 'valCode')} style={S.copyBtn}>{copiedText === 'valCode' ? '✓ Copied' : 'Copy'}</button>
              <pre style={S.codeBlock}><code>{`async function validateSession() {
  const response = await fetch(
    "https://doctorassist.ai/api/hms/integration/system/validate-widget-session",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: \`Bearer \${bearerToken}\`
      },
      body: JSON.stringify({ hospital_id, doctor_id, patient_id })
    }
  );
  if (!response.ok) throw new Error(\`Validation failed: \${response.status}\`);
  return await response.json();
}`}</code></pre>
            </div>
          </div>
        </div>
      );
    }

    if (widgetSubSection === 'w-globaldata') {
      return (
        <div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 300, letterSpacing: '-0.02em', marginBottom: '0.75rem' }}>Global Data Object</h1>
          <p style={{ fontSize: '0.85rem', color: T.textSec, lineHeight: 1.6, marginBottom: '1rem' }}>
            <code>window.DOCTOR_ASSIST_DATA</code> is a shared data object that widgets read from and write to.
          </p>
          <div style={{ position: 'relative', marginBottom: '1.5rem' }}>
            <button onClick={() => copyToClipboard(globalDataCode, 'gd')} style={S.copyBtn}>{copiedText === 'gd' ? '✓ Copied' : 'Copy'}</button>
            <pre style={S.codeBlock}><code>{globalDataCode}</code></pre>
          </div>
          <table style={S.table}>
            <thead><tr><th style={S.th}>Field</th><th style={S.th}>Type</th><th style={S.th}>Set By</th><th style={S.th}>Read By</th></tr></thead>
            <tbody>
              {[
                { field: 'transcript', type: 'string', set: 'TranscriptionWidget', read: 'DiagnosisWidget, TreatmentPlanWidget' },
                { field: 'diagnosis', type: 'string', set: 'DiagnosisWidget', read: 'TreatmentPlanWidget, CombinedDocumentationWidget' },
                { field: 'treatment_plan', type: 'string', set: 'TreatmentPlanWidget', read: 'CombinedDocumentationWidget, SaveSessionWidget' },
                { field: 'document_treatment_plan', type: 'string', set: 'TreatmentPlanWidget', read: 'CombinedDocumentationWidget' },
                { field: 'medications', type: 'array', set: 'MedicationWidget', read: 'CombinedDocumentationWidget, SaveSessionWidget' },
                { field: 'investigations', type: 'array', set: 'InvestigationWidget', read: 'CombinedDocumentationWidget, SaveSessionWidget' },
                { field: 'clinical_notes', type: 'string', set: 'ClinicalNotesWidget', read: 'CombinedDocumentationWidget, SaveSessionWidget' },
                { field: 'onboarding_summary', type: 'string', set: 'PatientOnboardingWidget', read: 'SaveSessionWidget' },
              ].map((row, i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${T.border}` }}>
                  <td style={S.td}><code>{row.field}</code></td>
                  <td style={S.td}>{row.type}</td>
                  <td style={S.td}><span style={{ fontSize: '0.7rem' }}>{row.set}</span></td>
                  <td style={S.td}><span style={{ fontSize: '0.7rem' }}>{row.read}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    if (widgetSubSection === 'w-fullexample') {
      return (
        <div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 300, letterSpacing: '-0.02em', marginBottom: '0.75rem' }}>Full HTML Integration Example</h1>
          <p style={{ fontSize: '0.85rem', color: T.textSec, lineHeight: 1.6, marginBottom: '1rem' }}>
            A complete, copy-paste ready HTML file demonstrating all widgets initialized together.
          </p>
          <div style={{ position: 'relative' }}>
            <button onClick={() => copyToClipboard(fullHtmlExample, 'fullhtml')} style={S.copyBtn}>{copiedText === 'fullhtml' ? '✓ Copied' : 'Copy'}</button>
            <pre style={{ ...S.codeBlock, maxHeight: '600px', overflowY: 'auto' }}><code>{fullHtmlExample}</code></pre>
          </div>
        </div>
      );
    }

    // Individual widget sections
    const widget = widgets.find(w => w.id === widgetSubSection);
    if (widget) {
      return (
        <div>
          <div style={{ marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px', flexWrap: 'wrap' }}>
              <span style={{ ...S.methodBadge, ...S.methodBadgeWidget }}>WIDGET</span>
              <code style={{ fontSize: '0.78rem', color: T.textSec, background: T.bgAlt, padding: '4px 8px', borderRadius: '2px' }}>window.{widget.globalName}</code>
            </div>
            <h1 style={{ fontSize: '1.4rem', fontWeight: 300, letterSpacing: '-0.02em', marginBottom: '0.75rem' }}>{widget.label}</h1>
            <p style={{ fontSize: '0.85rem', color: T.textSec, lineHeight: 1.6 }}>{widget.description}</p>
          </div>

          <div style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ fontSize: '0.75rem', fontWeight: 400, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.75rem', color: T.textMuted }}>Script Tag</h3>
            <div style={{ position: 'relative' }}>
              <button onClick={() => copyToClipboard(`<script src="${widget.scriptSrc}"></script>`, `${widget.id}-script`)} style={S.copyBtn}>{copiedText === `${widget.id}-script` ? '✓ Copied' : 'Copy'}</button>
              <pre style={S.codeBlock}><code>{`<script src="${widget.scriptSrc}"></script>`}</code></pre>
            </div>
          </div>

          <div style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ fontSize: '0.75rem', fontWeight: 400, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.75rem', color: T.textMuted }}>Container Element</h3>
            <pre style={S.codeBlock}><code>{`<div id="${widget.containerId}"></div>`}</code></pre>
          </div>

          <div style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ fontSize: '0.75rem', fontWeight: 400, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.75rem', color: T.textMuted }}>Init Parameters</h3>
            <div style={{ overflowX: 'auto' }}>
              <table style={S.table}>
                <thead><tr><th style={S.th}>Parameter</th><th style={S.th}>Type</th><th style={S.th}>Required</th><th style={S.th}>Description</th></tr></thead>
                <tbody>
                  {widget.params.map((p, i) => (
                    <tr key={i} style={{ borderBottom: `1px solid ${T.border}` }}>
                      <td style={S.td}><code>{p.name}</code></td>
                      <td style={S.td}>string</td>
                      <td style={S.td}><span style={S.methodBadge}>{p.required ? 'Yes' : 'No'}</span></td>
                      <td style={S.td}>{p.desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ fontSize: '0.75rem', fontWeight: 400, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.75rem', color: T.textMuted }}>Initialization Example</h3>
            <div style={{ position: 'relative' }}>
              <button onClick={() => copyToClipboard(widget.initCode, `${widget.id}-init`)} style={S.copyBtn}>{copiedText === `${widget.id}-init` ? '✓ Copied' : 'Copy'}</button>
              <pre style={S.codeBlock}><code>{widget.initCode}</code></pre>
            </div>
          </div>

          <div style={S.infoBox}>
            Always call <code>validateSession()</code> before initializing this widget and use the resolved IDs from the response — do not pass raw HMS IDs directly.
          </div>

          {/* ── Return Output + Save Endpoint Config ── */}
          {/* ── Return Output + Save Endpoint Config ── */}
<SaveEndpointConfig
  tag={widget.tag}
  sampleOutput={widget.sampleOutput}
  documentationOutputs={widget.documentationOutputs}
/>

          <div style={{ marginTop: '1.5rem' }}>
            <h3 style={{ fontSize: '0.75rem', fontWeight: 400, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.75rem', color: T.textMuted }}>Widget Preview</h3>
            <div style={{
              background: T.bgAlt,
              border: `1px solid ${T.border}`,
              borderRadius: '4px',
              overflow: 'hidden',
              aspectRatio: '16/9',
              position: 'relative',
            }}>
              {widget.videoSrc ? (
                <video key={widget.id} controls style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}>
                  <source src={widget.videoSrc} type="video/mp4" />
                  Your browser does not support the video tag.
                </video>
              ) : (
                <div style={{ width: '100%', height: '100%', minHeight: '220px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
                  <p style={{ margin: 0, fontSize: '0.72rem', color: T.textMuted }}>No preview available for <strong style={{ color: T.textSec, fontWeight: 400 }}>{widget.label}</strong></p>
                </div>
              )}
            </div>
          </div>
        </div>
      );
    }

    return null;
  };

  // ─── API Content ───
  const renderApiContent = () => {
    switch (selectedSection) {
      case 'authentication':
        return (
          <div>
            <div style={{ marginBottom: '1.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px', flexWrap: 'wrap' }}>
                <span style={{ ...S.methodBadge, ...S.methodBadgePost }}>POST</span>
                <code style={{ fontSize: '0.78rem', color: T.textSec, background: T.bgAlt, padding: '4px 8px', borderRadius: '2px' }}>https://doctorassist.ai/api/hms/users/auth/integrators/token</code>
                <span style={S.statHighlight}>Required</span>
              </div>
              <h1 style={{ fontSize: '1.4rem', fontWeight: 300, letterSpacing: '-0.02em', marginBottom: '0.75rem' }}>Get Bearer Token</h1>
              <p style={{ fontSize: '0.85rem', color: T.textSec, lineHeight: 1.5 }}>Obtain a new access token using your client credentials.</p>
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ fontSize: '0.75rem', fontWeight: 400, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.75rem', color: T.textMuted }}>Request Body</h3>
              <div style={{ background: T.bgAlt, padding: '1rem', border: `1px solid ${T.border}`, marginBottom: '1rem', borderRadius: '4px' }}>
                <pre style={{ margin: 0, fontSize: '0.72rem', fontFamily: 'monospace' }}>{`{\n  "client_id": "YOUR_CLIENT_ID",\n  "client_secret": "YOUR_CLIENT_SECRET"\n}`}</pre>
              </div>
              <h3 style={{ fontSize: '0.75rem', fontWeight: 400, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.75rem', color: T.textMuted }}>Example</h3>
              <div style={{ position: 'relative' }}>
                <LanguageButtons activeLang={authLanguage} onLangChange={setAuthLanguage} />
                <button onClick={() => copyToClipboard(authCodeExamples[authLanguage], 'auth')} style={S.copyBtn}>{copiedText === 'auth' ? '✓ Copied' : 'Copy'}</button>
                <pre style={S.codeBlock}><code>{authCodeExamples[authLanguage]}</code></pre>
              </div>
            </div>

            <div>
              <h3 style={{ fontSize: '0.75rem', fontWeight: 400, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.75rem', color: T.textMuted }}>Headers</h3>
              <table style={S.table}>
                <thead><tr><th style={S.th}>Name</th><th style={S.th}>Type</th><th style={S.th}>Required</th><th style={S.th}>Description</th></tr></thead>
                <tbody>
                  <tr><td style={S.td}><code>Content-Type</code></td><td style={S.td}>string</td><td style={S.td}><span style={S.methodBadge}>Yes</span></td><td style={S.td}>application/json</td></tr>
                </tbody>
              </table>
            </div>

            <div style={{ marginTop: '1.5rem' }}>
              <h3 style={{ fontSize: '0.75rem', fontWeight: 400, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.75rem', color: T.textMuted }}>How to Get Your Client ID & Secret</h3>
              <div style={{ background: T.bgAlt, border: `1px solid ${T.border}`, borderRadius: '4px', overflow: 'hidden', aspectRatio: '16/9' }}>
                <video controls style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}>
                  <source src="https://doctorassist.ai/api/hms/users/data/whatsapp/view/client_idandsecret_new.webm" type="video/mp4" />
                </video>
              </div>
              <p style={{ fontSize: '0.72rem', color: T.textMuted, marginTop: '0.5rem', lineHeight: 1.5 }}>
                This tutorial shows you how to obtain your client_id and client_secret credentials from the DoctorAssist developer portal.
              </p>
            </div>
          </div>
        );

      case 'refreshToken':
        return (
          <div>
            <div style={{ marginBottom: '1.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                <span style={{ ...S.methodBadge, ...S.methodBadgePost }}>POST</span>
                <code style={{ fontSize: '0.78rem', color: T.textSec, background: T.bgAlt, padding: '4px 8px', borderRadius: '2px' }}>https://doctorassist.ai/api/hms/users/auth/integrators/token</code>
              </div>
              <h1 style={{ fontSize: '1.4rem', fontWeight: 300, letterSpacing: '-0.02em', marginBottom: '0.75rem' }}>Refresh Bearer Token</h1>
              <p style={{ fontSize: '0.85rem', color: T.textSec, lineHeight: 1.5 }}>Refresh an expired access token using your current token.</p>
            </div>
            <h3 style={{ fontSize: '0.75rem', fontWeight: 400, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.75rem', color: T.textMuted }}>Request Body</h3>
            <div style={{ background: T.bgAlt, padding: '1rem', border: `1px solid ${T.border}`, marginBottom: '1rem', borderRadius: '4px' }}>
              <pre style={{ margin: 0, fontSize: '0.72rem', fontFamily: 'monospace' }}>{`{\n  "client_id": "YOUR_CLIENT_ID",\n  "client_secret": "YOUR_CLIENT_SECRET"\n}`}</pre>
            </div>
            <div style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ fontSize: '0.75rem', fontWeight: 400, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.75rem', color: T.textMuted }}>Example</h3>
              <div style={{ position: 'relative' }}>
                <LanguageButtons activeLang={refreshLanguage} onLangChange={setRefreshLanguage} />
                <button onClick={() => copyToClipboard(refreshCodeExamples[refreshLanguage], 'refresh')} style={S.copyBtn}>{copiedText === 'refresh' ? '✓ Copied' : 'Copy'}</button>
                <pre style={S.codeBlock}><code>{refreshCodeExamples[refreshLanguage]}</code></pre>
              </div>
            </div>
            <table style={S.table}>
              <thead><tr><th style={S.th}>Name</th><th style={S.th}>Type</th><th style={S.th}>Required</th><th style={S.th}>Description</th></tr></thead>
              <tbody>
                <tr><td style={S.td}><code>Authorization</code></td><td style={S.td}>string</td><td style={S.td}><span style={S.methodBadge}>Yes</span></td><td style={S.td}>Bearer token</td></tr>
              </tbody>
            </table>
          </div>
        );

      case 'patientDemographics':
        return (
          <div>
            <div style={{ marginBottom: '1.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px', flexWrap: 'wrap' }}>
                <span style={{ ...S.methodBadge, ...S.methodBadgePost }}>POST</span>
                <code style={{ fontSize: '0.78rem', color: T.textSec, background: T.bgAlt, padding: '4px 8px', borderRadius: '2px' }}>https://doctorassist.ai/api/hms/integration/system/patient-demographics</code>
                <span style={S.statHighlight}>Creates PatientContext</span>
              </div>
              <h1 style={{ fontSize: '1.4rem', fontWeight: 300, letterSpacing: '-0.02em', marginBottom: '0.75rem' }}>Patient Demographics</h1>
              <p style={{ fontSize: '0.85rem', color: T.textSec, lineHeight: 1.5 }}>Send patient demographics, personal data, and insurance profile.</p>
            </div>
            <div style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ fontSize: '0.75rem', fontWeight: 400, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.75rem', color: T.textMuted }}>Request Body</h3>
              <div style={{ position: 'relative' }}>
                <button onClick={() => copyToClipboard(demographicsExample, 'demo')} style={S.copyBtn}>{copiedText === 'demo' ? '✓ Copied' : 'Copy'}</button>
                <pre style={{ ...S.codeBlock, maxHeight: '400px', overflowY: 'auto' }}><code>{demographicsExample}</code></pre>
              </div>
            </div>
            <div style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ fontSize: '0.75rem', fontWeight: 400, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.75rem', color: T.textMuted }}>Example Code</h3>
              <div style={{ position: 'relative' }}>
                <LanguageButtons activeLang={demoLanguage} onLangChange={setDemoLanguage} />
                <button onClick={() => copyToClipboard(demographicsCodeExamples[demoLanguage], 'demoCode')} style={S.copyBtn}>{copiedText === 'demoCode' ? '✓ Copied' : 'Copy'}</button>
                <pre style={S.codeBlock}><code>{demographicsCodeExamples[demoLanguage]}</code></pre>
              </div>
            </div>
            <table style={S.table}>
              <thead><tr><th style={S.th}>Name</th><th style={S.th}>Type</th><th style={S.th}>Required</th><th style={S.th}>Description</th></tr></thead>
              <tbody>
                <tr><td style={S.td}><code>Authorization</code></td><td style={S.td}>string</td><td style={S.td}><span style={S.methodBadge}>Yes</span></td><td style={S.td}>Bearer token</td></tr>
              </tbody>
            </table>
          </div>
        );

      case 'appointments':
        return (
          <div>
            <div style={{ marginBottom: '1.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px', flexWrap: 'wrap' }}>
                <span style={{ ...S.methodBadge, ...S.methodBadgePost }}>POST</span>
                <code style={{ fontSize: '0.78rem', color: T.textSec, background: T.bgAlt, padding: '4px 8px', borderRadius: '2px' }}>https://doctorassist.ai/api/hms/integration/system/take_appointment</code>
              </div>
              <h1 style={{ fontSize: '1.4rem', fontWeight: 300, letterSpacing: '-0.02em', marginBottom: '0.75rem' }}>Appointments</h1>
              <p style={{ fontSize: '0.85rem', color: T.textSec, lineHeight: 1.5 }}>Schedule or update patient appointments with doctor details, visit type, and chief complaint.</p>
            </div>
            <div style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ fontSize: '0.75rem', fontWeight: 400, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.75rem', color: T.textMuted }}>Request Body</h3>
              <div style={{ position: 'relative' }}>
                <button onClick={() => copyToClipboard(`{\n  "hospital_id": "YOUR_HOSPITAL_ID",\n  "doctor_id": "YOUR_DOCTOR_ID",\n  "patient_id": "YOUR_PATIENT_ID",\n  "date": "YYYY-MM-DD",\n  "scheduled_time": "HH:MM",\n  "visit_type": "new/follow-up/emergency",\n  "appointment_id": "YOUR_APPOINTMENT_ID",\n  "chief_complaint": "Patient's chief complaint"\n}`, 'appt')} style={S.copyBtn}>{copiedText === 'appt' ? '✓ Copied' : 'Copy'}</button>
                <pre style={S.codeBlock}><code>{`{
  "hospital_id": "YOUR_HOSPITAL_ID",
  "doctor_id": "YOUR_DOCTOR_ID",
  "patient_id": "YOUR_PATIENT_ID",
  "date": "YYYY-MM-DD",
  "scheduled_time": "HH:MM",
  "visit_type": "new/follow-up/emergency",
  "appointment_id": "YOUR_APPOINTMENT_ID",
  "chief_complaint": "Patient's chief complaint"
}`}</code></pre>
              </div>
            </div>
            <div style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ fontSize: '0.75rem', fontWeight: 400, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.75rem', color: T.textMuted }}>Example Code</h3>
              <div style={{ position: 'relative' }}>
                <LanguageButtons activeLang={appointmentLanguage} onLangChange={setAppointmentLanguage} />
                <button onClick={() => copyToClipboard(appointmentCodeExamples[appointmentLanguage], 'apptCode')} style={S.copyBtn}>{copiedText === 'apptCode' ? '✓ Copied' : 'Copy'}</button>
                <pre style={S.codeBlock}><code>{appointmentCodeExamples[appointmentLanguage]}</code></pre>
              </div>
            </div>
            <table style={S.table}>
              <thead><tr><th style={S.th}>Name</th><th style={S.th}>Type</th><th style={S.th}>Required</th><th style={S.th}>Description</th></tr></thead>
              <tbody>
                <tr><td style={S.td}><code>Authorization</code></td><td style={S.td}>string</td><td style={S.td}><span style={S.methodBadge}>Yes</span></td><td style={S.td}>Bearer token</td></tr>
              </tbody>
            </table>
          </div>
        );

      case 'patientVitals':
        return (
          <div>
            <div style={{ marginBottom: '1.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px', flexWrap: 'wrap' }}>
                <span style={{ ...S.methodBadge, ...S.methodBadgePost }}>POST</span>
                <code style={{ fontSize: '0.78rem', color: T.textSec, background: T.bgAlt, padding: '4px 8px', borderRadius: '2px' }}>https://doctorassist.ai/api/hms/integration/system/save_patient_vitals</code>
              </div>
              <h1 style={{ fontSize: '1.4rem', fontWeight: 300, letterSpacing: '-0.02em', marginBottom: '0.75rem' }}>Patient Vitals</h1>
              <p style={{ fontSize: '0.85rem', color: T.textSec, lineHeight: 1.5 }}>Send patient vital signs including blood pressure, pulse, temperature, and more.</p>
            </div>
            <div style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ fontSize: '0.75rem', fontWeight: 400, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.75rem', color: T.textMuted }}>Request Body</h3>
              <div style={{ position: 'relative' }}>
                <button onClick={() => copyToClipboard(vitalsExample, 'vitals')} style={S.copyBtn}>{copiedText === 'vitals' ? '✓ Copied' : 'Copy'}</button>
                <pre style={S.codeBlock}><code>{vitalsExample}</code></pre>
              </div>
            </div>
            <div style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ fontSize: '0.75rem', fontWeight: 400, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.75rem', color: T.textMuted }}>Example Code</h3>
              <div style={{ position: 'relative' }}>
                <LanguageButtons activeLang={vitalsLanguage} onLangChange={setVitalsLanguage} />
                <button onClick={() => copyToClipboard(vitalsCodeExamples[vitalsLanguage], 'vitalsCode')} style={S.copyBtn}>{copiedText === 'vitalsCode' ? '✓ Copied' : 'Copy'}</button>
                <pre style={S.codeBlock}><code>{vitalsCodeExamples[vitalsLanguage]}</code></pre>
              </div>
            </div>
            <table style={S.table}>
              <thead><tr><th style={S.th}>Name</th><th style={S.th}>Type</th><th style={S.th}>Required</th><th style={S.th}>Description</th></tr></thead>
              <tbody>
                <tr><td style={S.td}><code>Authorization</code></td><td style={S.td}>string</td><td style={S.td}><span style={S.methodBadge}>Yes</span></td><td style={S.td}>Bearer token</td></tr>
              </tbody>
            </table>
          </div>
        );

      case 'reports':
        return (
          <div>
            <div style={{ marginBottom: '1.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px', flexWrap: 'wrap' }}>
                <span style={{ ...S.methodBadge, ...S.methodBadgePost }}>POST</span>
                <code style={{ fontSize: '0.78rem', color: T.textSec, background: T.bgAlt, padding: '4px 8px', borderRadius: '2px' }}>https://doctorassist.ai/api/hms/integration/system/patient_upload_report</code>
                <span style={S.statHighlight}>Upload Reports</span>
              </div>
              <h1 style={{ fontSize: '1.4rem', fontWeight: 300, letterSpacing: '-0.02em', marginBottom: '0.75rem' }}>Upload Patient Reports</h1>
              <p style={{ fontSize: '0.85rem', color: T.textSec, lineHeight: 1.5 }}>Upload medical reports and documents for a patient.</p>
            </div>
            <div style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ fontSize: '0.75rem', fontWeight: 400, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.75rem', color: T.textMuted }}>Request Body</h3>
              <div style={{ position: 'relative' }}>
                <button onClick={() => copyToClipboard(reportsExample, 'reports')} style={S.copyBtn}>{copiedText === 'reports' ? '✓ Copied' : 'Copy'}</button>
                <pre style={S.codeBlock}><code>{reportsExample}</code></pre>
              </div>
            </div>
            <div style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ fontSize: '0.75rem', fontWeight: 400, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.75rem', color: T.textMuted }}>Example Code</h3>
              <div style={{ position: 'relative' }}>
                <LanguageButtons activeLang={reportsLanguage} onLangChange={setReportsLanguage} />
                <button onClick={() => copyToClipboard(reportsCodeExamples[reportsLanguage], 'reportsCode')} style={S.copyBtn}>{copiedText === 'reportsCode' ? '✓ Copied' : 'Copy'}</button>
                <pre style={S.codeBlock}><code>{reportsCodeExamples[reportsLanguage]}</code></pre>
              </div>
            </div>
            <table style={S.table}>
              <thead><tr><th style={S.th}>Name</th><th style={S.th}>Type</th><th style={S.th}>Required</th><th style={S.th}>Description</th></tr></thead>
              <tbody>
                <tr><td style={S.td}><code>Authorization</code></td><td style={S.td}>string</td><td style={S.td}><span style={S.methodBadge}>Yes</span></td><td style={S.td}>Bearer token</td></tr>
              </tbody>
            </table>
          </div>
        );

      case 'labReports':
        return (
          <div>
            <div style={{ marginBottom: '1.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px', flexWrap: 'wrap' }}>
                <span style={{ ...S.methodBadge, ...S.methodBadgePost }}>POST</span>
                <code style={{ fontSize: '0.78rem', color: T.textSec, background: T.bgAlt, padding: '4px 8px', borderRadius: '2px' }}>https://doctorassist.ai/api/hms/integration/system/add_patient_lab_reports</code>
                <span style={S.statHighlight}>Lab Reports</span>
              </div>
              <h1 style={{ fontSize: '1.4rem', fontWeight: 300, letterSpacing: '-0.02em', marginBottom: '0.75rem' }}>Lab Reports</h1>
              <p style={{ fontSize: '0.85rem', color: T.textSec, lineHeight: 1.5 }}>Send patient lab report results along with individual parameters and their normal reference ranges.</p>
            </div>
            <div style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ fontSize: '0.75rem', fontWeight: 400, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.75rem', color: T.textMuted }}>Request Body</h3>
              <div style={{ position: 'relative' }}>
                <button onClick={() => copyToClipboard(labReportsExample, 'labReports')} style={S.copyBtn}>{copiedText === 'labReports' ? '✓ Copied' : 'Copy'}</button>
                <pre style={S.codeBlock}><code>{labReportsExample}</code></pre>
              </div>
            </div>
            <div style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ fontSize: '0.75rem', fontWeight: 400, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.75rem', color: T.textMuted }}>Example Code</h3>
              <div style={{ position: 'relative' }}>
                <LanguageButtons activeLang={labReportsLanguage} onLangChange={setLabReportsLanguage} />
                <button onClick={() => copyToClipboard(labReportsCodeExamples[labReportsLanguage], 'labReportsCode')} style={S.copyBtn}>{copiedText === 'labReportsCode' ? '✓ Copied' : 'Copy'}</button>
                <pre style={S.codeBlock}><code>{labReportsCodeExamples[labReportsLanguage]}</code></pre>
              </div>
            </div>
            <table style={S.table}>
              <thead><tr><th style={S.th}>Name</th><th style={S.th}>Type</th><th style={S.th}>Required</th><th style={S.th}>Description</th></tr></thead>
              <tbody>
                <tr><td style={S.td}><code>Authorization</code></td><td style={S.td}>string</td><td style={S.td}><span style={S.methodBadge}>Yes</span></td><td style={S.td}>Bearer token</td></tr>
              </tbody>
            </table>
          </div>
        );

      case 'visitHistory':
        return (
          <div>
            <div style={{ marginBottom: '1.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px', flexWrap: 'wrap' }}>
                <span style={{ ...S.methodBadge, ...S.methodBadgePost }}>POST</span>
                <code style={{ fontSize: '0.78rem', color: T.textSec, background: T.bgAlt, padding: '4px 8px', borderRadius: '2px' }}>https://doctorassist.ai/api/hms/integration/system/add_patient_visit_history</code>
                <span style={S.statHighlight}>Visit History</span>
              </div>
              <h1 style={{ fontSize: '1.4rem', fontWeight: 300, letterSpacing: '-0.02em', marginBottom: '0.75rem' }}>Patient Visit History</h1>
              <p style={{ fontSize: '0.85rem', color: T.textSec, lineHeight: 1.5 }}>Send detailed patient visit records including complaint history, diagnosis, investigations, procedures, and prescribed medications.</p>
            </div>
            <div style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ fontSize: '0.75rem', fontWeight: 400, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.75rem', color: T.textMuted }}>Request Body</h3>
              <div style={{ position: 'relative' }}>
                <button onClick={() => copyToClipboard(visitHistoryExample, 'visitHistory')} style={S.copyBtn}>{copiedText === 'visitHistory' ? '✓ Copied' : 'Copy'}</button>
                <pre style={{ ...S.codeBlock, maxHeight: '450px', overflowY: 'auto' }}><code>{visitHistoryExample}</code></pre>
              </div>
            </div>
            <div style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ fontSize: '0.75rem', fontWeight: 400, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.75rem', color: T.textMuted }}>Example Code</h3>
              <div style={{ position: 'relative' }}>
                <LanguageButtons activeLang={visitHistoryLanguage} onLangChange={setVisitHistoryLanguage} />
                <button onClick={() => copyToClipboard(visitHistoryCodeExamples[visitHistoryLanguage], 'visitHistoryCode')} style={S.copyBtn}>{copiedText === 'visitHistoryCode' ? '✓ Copied' : 'Copy'}</button>
                <pre style={S.codeBlock}><code>{visitHistoryCodeExamples[visitHistoryLanguage]}</code></pre>
              </div>
            </div>
            <table style={S.table}>
              <thead><tr><th style={S.th}>Name</th><th style={S.th}>Type</th><th style={S.th}>Required</th><th style={S.th}>Description</th></tr></thead>
              <tbody>
                <tr><td style={S.td}><code>Authorization</code></td><td style={S.td}>string</td><td style={S.td}><span style={S.methodBadge}>Yes</span></td><td style={S.td}>Bearer token</td></tr>
              </tbody>
            </table>
          </div>
        );

      default:
        return null;
    }
  };

  const currentNavSections = activeTab === 'api' ? navSections : widgetNavSections;
  const currentSection = activeTab === 'api' ? selectedSection : widgetSubSection;
  const setCurrentSection = activeTab === 'api' ? setSelectedSection : setWidgetSubSection;

  const getSectionTitle = () => {
    if (activeTab === 'api') {
      const map = {
        authentication: 'Get Bearer Token', refreshToken: 'Refresh Bearer Token',
        patientDemographics: 'Patient Demographics', appointments: 'Appointments',
        patientVitals: 'Patient Vitals', reports: 'Upload Patient Reports',
        labReports: 'Lab Reports', visitHistory: 'Patient Visit History',
      };
      return map[selectedSection] || '';
    } else {
      const map = {
        overview: 'Widget Overview', setup: 'Setup & Installation', validation: 'Session Validation',
        'w-patient': 'Patient Summary Widget', 'w-transcription': 'Transcription Widget',
        'w-diagnosis': 'Diagnosis Widget', 'w-treatmentplan': 'Treatment Plan Widget',
        'w-combined': 'Combined Documentation Widget', 'w-reportupload': 'Report Upload Widget',
        'w-save': 'Save Session Widget', 'w-globaldata': 'Global Data Object',
        'w-fullexample': 'Full HTML Example',
      };
      return map[widgetSubSection] || '';
    }
  };

  const downloadExcelTemplate = () => {
    const worksheetData = [
      ['hms_doctor_id', 'name', 'reg_number', 'speciality', 'qualification', 'phone_number', 'email', 'username', 'password', 'address', 'country'],
      ['', '', '', '', '', '', '', '', '', '', '']
    ];
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(worksheetData);
    ws['!cols'] = [{wch:15},{wch:20},{wch:15},{wch:15},{wch:15},{wch:15},{wch:25},{wch:20},{wch:20},{wch:30},{wch:15}];
    XLSX.utils.book_append_sheet(wb, ws, 'Doctors');
    XLSX.writeFile(wb, 'doctor_template.xlsx');
  };

  const downloadPostmanCollection = async () => {
    try {
      const response = await fetch('https://doctorassist.ai/api/hms/users/data/system/get_postman_collection', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!response.ok) throw new Error(`Failed: ${response.status}`);
      const collectionData = await response.json();
      const blob = new Blob([JSON.stringify(collectionData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'DoctorAssist.Ai_Postman_Collection.json';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      alert('Failed to download Postman collection. Please try again.');
    }
  };

  return (
    <div style={S.layout}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600&display=swap');
        * { box-sizing: border-box; }
        ::selection { background: #000; color: #fff; }
        .da-nav-btn:hover { background: ${T.bgAlt} !important; color: ${T.text} !important; }
        .da-menu-scroll::-webkit-scrollbar { width: 3px; }
        .da-menu-scroll::-webkit-scrollbar-track { background: ${T.bgAlt}; }
        .da-menu-scroll::-webkit-scrollbar-thumb { background: ${T.border}; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .da-content { animation: fadeIn 0.3s ease-out; }
        input:focus { border-color: #000 !important; }
      `}</style>

      {/* ─── Sidebar ─── */}
      <aside style={S.sidebar}>
        <div style={S.sidebarHeader}>
          <div style={S.brandRow}><span style={S.brandName}>DoctorAssist.AI</span></div>
          <span style={S.sectionLabel}>{activeTab === 'api' ? 'API Reference' : 'Widget Docs'}</span>
          <p style={S.doctorName}>HMS Integration</p>
        </div>
        <div className="da-menu-scroll" style={S.menuScroll}>
          {currentNavSections.map((sec, si) => (
            <div key={si}>
              <span style={S.navGroupLabel}>{sec.label}</span>
              {sec.items.map((item, ii) => {
                const isActive = currentSection === item.id;
                const badgeStyle = item.method === 'WDG'
                  ? { ...S.methodBadge, ...S.methodBadgeWidget }
                  : item.method === 'POST'
                  ? { ...S.methodBadge, ...S.methodBadgePost }
                  : { ...S.methodBadge };
                return (
                  <button key={ii} className="da-nav-btn"
                    style={{ ...S.navBtn, ...(isActive ? S.navBtnActive : {}) }}
                    onClick={() => setCurrentSection(item.id)}>
                    <span style={{ ...badgeStyle, fontSize: '0.5rem', padding: '2px 5px' }}>{item.method}</span>
                    <span style={{ flex: 1 }}>{item.label}</span>
                    {isActive && <span style={{ fontSize: '0.6rem', color: T.textMuted }}>→</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div style={S.sidebarFooter}><div style={S.logoutBtn}><span>© 2025 DoctorAssist</span></div></div>
      </aside>

      {/* ─── Main ─── */}
      <main style={S.main}>
        <div style={S.topBar}>
          <div style={S.topBarLeft}>
            <span style={S.topBarTitle}>HMS Integration Guide</span>
          </div>
          <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
            <span style={{ fontSize: '0.65rem', color: T.textMuted, letterSpacing: '0.05em' }}>REST API</span>
            <span style={{ fontSize: '0.65rem', color: T.textMuted, letterSpacing: '0.05em' }}>JSON</span>
            <button onClick={downloadExcelTemplate} style={{ padding: '6px 14px', fontSize: '0.7rem', fontWeight: 400, fontFamily: "'Open Sans', sans-serif", background: '#000', color: '#fff', border: '1px solid #000', borderRadius: '2px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
              onMouseEnter={e => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.color = '#000'; }}
              onMouseLeave={e => { e.currentTarget.style.background = '#000'; e.currentTarget.style.color = '#fff'; }}>
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M8 1V11M8 11L11 8M8 11L5 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M3 13H13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
              Download Template
            </button>
            <button onClick={downloadPostmanCollection} style={{ padding: '6px 14px', fontSize: '0.7rem', fontWeight: 400, fontFamily: "'Open Sans', sans-serif", background: '#000', color: '#fff', border: '1px solid #000', borderRadius: '2px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
              onMouseEnter={e => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.color = '#000'; }}
              onMouseLeave={e => { e.currentTarget.style.background = '#000'; e.currentTarget.style.color = '#fff'; }}>
              Postman Collection
            </button>
          </div>
        </div>

        {/* Tab Bar */}
        <div style={S.tabBar}>
          <button style={{ ...S.tabBtn, ...(activeTab === 'api' ? S.tabBtnActive : {}) }} onClick={() => { setActiveTab('api'); setSelectedSection('authentication'); }}>API Reference</button>
          <button style={{ ...S.tabBtn, ...(activeTab === 'widgets' ? S.tabBtnActive : {}) }} onClick={() => { setActiveTab('widgets'); setWidgetSubSection('overview'); }}>Widgets</button>
        </div>

        <div style={S.body}>
          <div className="da-content" key={`${activeTab}-${currentSection}`} style={S.sectionCard}>
            <div style={S.sectionHeader}>
              <h2 style={S.sectionTitle}>{getSectionTitle()}</h2>
              <p style={S.sectionSub}>{activeTab === 'api' ? 'API endpoint documentation' : 'Widget integration documentation'}</p>
            </div>
            <div style={S.contentArea}>
              {activeTab === 'api' ? renderApiContent() : renderWidgetContent()}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default DoctorAssistApiReference;