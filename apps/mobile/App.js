import React, { useMemo, useState } from "react";
import { Alert, Image, Linking, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import * as FileSystem from "expo-file-system";
import * as MediaLibrary from "expo-media-library";
import { StatusBar } from "expo-status-bar";

const API_BASE = process.env.EXPO_PUBLIC_API_BASE_URL || "http://localhost:4000";
const API_TOKEN = process.env.EXPO_PUBLIC_API_TOKEN || "";

export default function App() {
  const [url, setUrl] = useState("");
  const [analysis, setAnalysis] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [selected, setSelected] = useState({ type: "video", quality: "1080p", format: "mp4" });
  const [busy, setBusy] = useState(false);

  const qualities = useMemo(() => {
    if (selected.type === "audio") return ["best"];
    return analysis?.videoQualities?.length ? [...analysis.videoQualities, "best"] : ["144p", "240p", "360p", "480p", "720p", "1080p", "best"];
  }, [analysis, selected.type]);

  async function analyze() {
    setBusy(true);
    try {
      const data = await request("/api/media/analyze", { method: "POST", body: { url } });
      setAnalysis(data);
    } catch (error) {
      Alert.alert("Analyze failed", error.message);
    } finally {
      setBusy(false);
    }
  }

  async function startDownload() {
    try {
      const job = await request("/api/downloads", { method: "POST", body: { url, ...selected } });
      setJobs((current) => [job, ...current]);
      watchJob(job.id);
    } catch (error) {
      Alert.alert("Download failed", error.message);
    }
  }

  async function watchJob(id) {
    const timer = setInterval(async () => {
      try {
        const job = await request(`/api/downloads/${id}`);
        setJobs((current) => current.map((item) => (item.id === id ? job : item)));
        if (["Completed", "Failed", "Canceled"].includes(job.state)) clearInterval(timer);
      } catch {
        clearInterval(timer);
      }
    }, 1500);
  }

  async function jobControl(id, action) {
    try {
      const job = await request(`/api/downloads/${id}/${action}`, { method: "POST" });
      setJobs((current) => current.map((item) => (item.id === id ? job : item)));
      if (action === "retry") watchJob(id);
    } catch (error) {
      Alert.alert("Control failed", error.message);
    }
  }

  async function saveToDevice(job) {
    const permission = await MediaLibrary.requestPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Permission needed", "Media library permission is required to save files.");
      return;
    }

    const fileUrl = `${API_BASE}/api/downloads/${job.id}/file${API_TOKEN ? `?token=${encodeURIComponent(API_TOKEN)}` : ""}`;
    const localPath = `${FileSystem.documentDirectory}${job.fileName || `${job.id}.${job.request.format}`}`;
    const result = await FileSystem.downloadAsync(fileUrl, localPath, {
      headers: API_TOKEN ? { Authorization: `Bearer ${API_TOKEN}` } : {}
    });
    const asset = await MediaLibrary.createAssetAsync(result.uri);
    const albumName = job.request.type === "audio" ? "Music" : "Download";
    await MediaLibrary.createAlbumAsync(albumName, asset, false).catch(() => null);
    Alert.alert("Saved", "The file was saved to device storage where the OS allows media indexing.");
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Media Download Manager</Text>
        <View style={styles.card}>
          <TextInput value={url} onChangeText={setUrl} placeholder="Paste a supported video URL" autoCapitalize="none" style={styles.input} />
          <TouchableOpacity disabled={!url || busy} onPress={analyze} style={[styles.button, (!url || busy) && styles.disabled]}>
            <Text style={styles.buttonText}>Analyze</Text>
          </TouchableOpacity>
        </View>

        {analysis && (
          <View style={styles.card}>
            {analysis.thumbnail && <Image source={{ uri: analysis.thumbnail }} style={styles.thumbnail} />}
            <Text style={styles.heading}>{analysis.title}</Text>
            <Text style={styles.muted}>{formatDuration(analysis.duration)}</Text>
            <OptionRow label="Mode" values={["video", "video-only", "audio"]} value={selected.type} onChange={(type) => setSelected({ ...selected, type, format: type === "audio" ? "mp3" : "mp4" })} />
            <OptionRow label="Quality" values={qualities} value={selected.quality} onChange={(quality) => setSelected({ ...selected, quality })} />
            <OptionRow label="Format" values={selected.type === "audio" ? ["mp3", "m4a", "opus", "webm"] : ["mp4", "webm", "mkv"]} value={selected.format} onChange={(format) => setSelected({ ...selected, format })} />
            <TouchableOpacity onPress={startDownload} style={styles.button}>
              <Text style={styles.buttonText}>Start Download</Text>
            </TouchableOpacity>
          </View>
        )}

        <Text style={styles.sectionTitle}>Downloads</Text>
        {jobs.map((job) => (
          <View key={job.id} style={styles.card}>
            <Text numberOfLines={1} style={styles.heading}>{job.fileName || job.request.url}</Text>
            <Text style={styles.muted}>{job.state}{job.speed ? ` · ${job.speed}` : ""}{job.eta ? ` · ETA ${job.eta}` : ""} - {Math.round(job.progress || 0)}%</Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressBar, { width: `${Math.min(job.progress || 0, 100)}%` }]} />
            </View>
            <View style={styles.controls}>
              {job.state === "Paused" ? (
                <TouchableOpacity onPress={() => jobControl(job.id, "resume")} style={styles.controlBtn}>
                  <Text style={styles.controlText}>Resume</Text>
                </TouchableOpacity>
              ) : ["Pending", "Fetching information", "Processing", "Converting", "Downloading"].includes(job.state) ? (
                <TouchableOpacity onPress={() => jobControl(job.id, "pause")} style={styles.controlBtn}>
                  <Text style={styles.controlText}>Pause</Text>
                </TouchableOpacity>
              ) : null}
              {!["Completed", "Failed", "Canceled"].includes(job.state) && (
                <TouchableOpacity onPress={() => jobControl(job.id, "cancel")} style={[styles.controlBtn, styles.cancelBtn]}>
                  <Text style={[styles.controlText, styles.cancelText]}>Cancel</Text>
                </TouchableOpacity>
              )}
              {["Failed", "Canceled"].includes(job.state) && (
                <TouchableOpacity onPress={() => jobControl(job.id, "retry")} style={styles.controlBtn}>
                  <Text style={styles.controlText}>Retry</Text>
                </TouchableOpacity>
              )}
            </View>
            {job.error && <Text style={styles.errorText}>{job.error}</Text>}
            {job.state === "Completed" && (
              <TouchableOpacity onPress={() => saveToDevice(job)} style={styles.secondaryButton}>
                <Text style={styles.secondaryText}>Save to Device Storage</Text>
              </TouchableOpacity>
            )}
          </View>
        ))}

        <TouchableOpacity onPress={() => Linking.openURL(API_BASE)} style={styles.linkButton}>
          <Text style={styles.linkText}>Backend: {API_BASE}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(API_TOKEN ? { Authorization: `Bearer ${API_TOKEN}` } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

function OptionRow({ label, values, value, onChange }) {
  return (
    <View style={styles.optionBlock}>
      <Text style={styles.label}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {values.map((item) => (
          <TouchableOpacity key={item} onPress={() => onChange(item)} style={[styles.chip, value === item && styles.chipActive]}>
            <Text style={[styles.chipText, value === item && styles.chipTextActive]}>{String(item).toUpperCase()}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

function formatDuration(seconds) {
  if (!seconds) return "Duration unavailable";
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}:${String(remaining).padStart(2, "0")}`;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f7f8fb" },
  container: { padding: 16, gap: 14 },
  title: { fontSize: 24, fontWeight: "800", color: "#17202a" },
  sectionTitle: { marginTop: 8, fontSize: 18, fontWeight: "700", color: "#17202a" },
  card: { gap: 12, borderWidth: 1, borderColor: "#dfe3ea", borderRadius: 8, backgroundColor: "#fff", padding: 14 },
  input: { minHeight: 44, borderWidth: 1, borderColor: "#dfe3ea", borderRadius: 6, paddingHorizontal: 12 },
  button: { minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: 6, backgroundColor: "#1d7a8c" },
  buttonText: { color: "#fff", fontWeight: "800" },
  disabled: { opacity: 0.55 },
  thumbnail: { width: "100%", aspectRatio: 16 / 9, borderRadius: 6, backgroundColor: "#e8ebf0" },
  heading: { fontSize: 15, fontWeight: "700", color: "#17202a" },
  muted: { color: "#536170" },
  optionBlock: { gap: 8 },
  label: { fontSize: 12, fontWeight: "800", color: "#536170" },
  chip: { minHeight: 34, justifyContent: "center", marginRight: 8, borderWidth: 1, borderColor: "#dfe3ea", borderRadius: 6, paddingHorizontal: 12 },
  chipActive: { borderColor: "#1d7a8c", backgroundColor: "#1d7a8c" },
  chipText: { color: "#17202a", fontWeight: "700" },
  chipTextActive: { color: "#fff" },
  progressTrack: { height: 8, overflow: "hidden", borderRadius: 99, backgroundColor: "#e8ebf0" },
  progressBar: { height: 8, backgroundColor: "#1d7a8c" },
  secondaryButton: { minHeight: 40, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#1d7a8c", borderRadius: 6 },
  secondaryText: { color: "#1d7a8c", fontWeight: "800" },
  controls: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  controlBtn: { minHeight: 34, paddingHorizontal: 14, alignItems: "center", justifyContent: "center", borderRadius: 6, borderWidth: 1, borderColor: "#1d7a8c" },
  controlText: { color: "#1d7a8c", fontWeight: "700", fontSize: 13 },
  cancelBtn: { borderColor: "#d9534f" },
  cancelText: { color: "#d9534f" },
  errorText: { color: "#d9534f", fontSize: 12 },
  linkButton: { alignItems: "center", paddingVertical: 6 },
  linkText: { color: "#536170", fontSize: 12 }
});

