//! Git log graph context — ports `gitDecorationParse`, `gitTabGraphModel`, and
//! `buildGitLogFileGraphContext` / chron pipeline from `gitTabGraphBranchColors.ts` + heatmap.

use serde::Deserialize;
use std::collections::{HashMap, HashSet};

const TAG_PREFIX: &str = "tag: ";
const GITGRAPH_SYNTHETIC_SINGLE_BRANCH_REF: &str = "history";

const GRUVBOX_BRANCH_PALETTE_HEAT_INDICES: [usize; 11] = [0, 3, 6, 9, 1, 4, 7, 10, 2, 5, 8];

fn gruvbox_heatmap_css_var(i: usize) -> String {
    let i = i.min(10);
    format!("var(--heatmap-{:02})", i)
}

fn gruvbox_graph_fallback_stroke() -> String {
    gruvbox_heatmap_css_var(2)
}

fn palette_index_for_branch_name(branch_name: &str, palette_len: usize) -> usize {
    if palette_len == 0 {
        return 0;
    }
    let s = branch_name.trim();
    let s = if s.is_empty() { "HEAD" } else { s };
    let mut h: u32 = 2166136261;
    for ch in s.chars() {
        h ^= ch as u32;
        h = h.wrapping_mul(16777619);
    }
    (h as usize) % palette_len
}

fn palette_color_for_branch_name(branch_name: &str, palette: &[String]) -> String {
    let i = palette_index_for_branch_name(branch_name, palette.len());
    palette
        .get(i)
        .cloned()
        .unwrap_or_else(gruvbox_graph_fallback_stroke)
}

fn parse_git_decoration_refs(raw: &str) -> Vec<String> {
    let t = raw.trim();
    if t.is_empty() {
        return Vec::new();
    }
    t.split(',')
        .map(|part| {
            let mut t = part.trim().to_string();
            const HEAD: &str = "HEAD -> ";
            if t.starts_with(HEAD) {
                t = t[HEAD.len()..].trim().to_string();
            }
            t
        })
        .filter(|s| !s.is_empty())
        .collect()
}

fn parse_current_branch_from_decorations(raw: &str) -> Option<String> {
    for part in raw.split(',') {
        let t = part.trim();
        if let Some(rest) = t.strip_prefix("HEAD -> ") {
            let branch = rest.trim();
            if !branch.is_empty() {
                return Some(branch.to_string());
            }
        }
    }
    None
}

fn is_git_branch_ref_name(ref_name: &str) -> bool {
    let trimmed = ref_name.trim();
    if trimmed.is_empty() || trimmed == "HEAD" {
        return false;
    }
    if trimmed.starts_with(TAG_PREFIX) {
        return false;
    }
    true
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitLogEntryIn {
    pub hash: String,
    #[serde(default)]
    pub parents: Vec<String>,
    #[serde(default)]
    pub decorations: String,
}

#[derive(Debug, Clone)]
pub enum GraphEdgeConnectivity {
    None,
    NextRowWhenNoGitParents,
    NextRowWhenNoDisplayedParents,
}

impl GraphEdgeConnectivity {
    fn from_str(s: &str) -> Self {
        match s {
            "none" => GraphEdgeConnectivity::None,
            "nextRowWhenNoDisplayedParents" => GraphEdgeConnectivity::NextRowWhenNoDisplayedParents,
            _ => GraphEdgeConnectivity::NextRowWhenNoGitParents,
        }
    }
}

#[derive(Debug, Clone)]
struct CommitGraphVertex {
    display_parents: Vec<String>,
    synthetic_edges: Vec<SyntheticEdge>,
}

#[derive(Debug, Clone)]
struct SyntheticEdge {
    to_hash: String,
}

fn build_commit_graph_model(
    entries_newest_first: &[GitLogEntryIn],
    connectivity: &GraphEdgeConnectivity,
) -> HashMap<String, CommitGraphVertex> {
    let hash_set: HashSet<String> = entries_newest_first.iter().map(|e| e.hash.clone()).collect();
    let n = entries_newest_first.len();
    let mut vertices = HashMap::new();

    for (index, entry) in entries_newest_first.iter().enumerate() {
        let raw_parent_hashes: Vec<String> = entry.parents.clone();
        let display_parents: Vec<String> = raw_parent_hashes
            .iter()
            .filter(|p| hash_set.contains(*p))
            .cloned()
            .collect();
        let mut synthetic_edges: Vec<SyntheticEdge> = Vec::new();

        let can_thread = index + 1 < n;
        let next_hash = if can_thread {
            entries_newest_first[index + 1].hash.clone()
        } else {
            String::new()
        };

        if display_parents.is_empty() && can_thread && !next_hash.is_empty() {
            match connectivity {
                GraphEdgeConnectivity::NextRowWhenNoDisplayedParents => {
                    synthetic_edges.push(SyntheticEdge {
                        to_hash: next_hash,
                    });
                }
                GraphEdgeConnectivity::NextRowWhenNoGitParents => {
                    if raw_parent_hashes.is_empty() {
                        synthetic_edges.push(SyntheticEdge {
                            to_hash: next_hash,
                        });
                    }
                }
                GraphEdgeConnectivity::None => {}
            }
        }

        vertices.insert(
            entry.hash.clone(),
            CommitGraphVertex {
                display_parents,
                synthetic_edges,
            },
        );
    }

    vertices
}

fn import_parent_hashes_for_gitgraph(vertex: &CommitGraphVertex) -> Vec<String> {
    if !vertex.display_parents.is_empty() {
        return vertex.display_parents.clone();
    }
    for e in &vertex.synthetic_edges {
        return vec![e.to_hash.clone()];
    }
    Vec::new()
}

#[derive(Debug, Clone)]
struct ChronRow {
    hash: String,
    parents: Vec<String>,
    refs: Vec<String>,
}

fn master_ref_sort_tier(r: &str) -> i32 {
    let t = r.trim().to_lowercase();
    if t == "master" {
        return 0;
    }
    if t == "origin/master" {
        return 1;
    }
    2
}

fn compare_gitgraph_branch_names(a: &str, b: &str) -> std::cmp::Ordering {
    let a_empty = if a.is_empty() { 1 } else { 0 };
    let b_empty = if b.is_empty() { 1 } else { 0 };
    if a_empty != b_empty {
        return a_empty.cmp(&b_empty);
    }
    let ma = master_ref_sort_tier(a);
    let mb = master_ref_sort_tier(b);
    if ma != mb {
        return ma.cmp(&mb);
    }
    let a_remote = a.starts_with("origin/") as i32;
    let b_remote = b.starts_with("origin/") as i32;
    if a_remote != b_remote {
        return a_remote.cmp(&b_remote);
    }
    a.cmp(b)
}

fn ensure_branch_refs_for_gitgraph_import(rows: &mut [ChronRow]) {
    if rows.is_empty() {
        return;
    }
    let all_empty = rows.iter().all(|r| r.refs.is_empty());
    if !all_empty {
        return;
    }
    rows[0].refs = vec![GITGRAPH_SYNTHETIC_SINGLE_BRANCH_REF.to_string()];
}

fn build_chronological_rows(
    entries_newest_first: &[GitLogEntryIn],
    connectivity: &GraphEdgeConnectivity,
) -> Vec<ChronRow> {
    let vertices = build_commit_graph_model(entries_newest_first, connectivity);
    let mut rows_newest: Vec<ChronRow> = Vec::new();
    for entry in entries_newest_first {
        let parents = vertices
            .get(&entry.hash)
            .map(import_parent_hashes_for_gitgraph)
            .unwrap_or_default();
        let refs = parse_git_decoration_refs(&entry.decorations);
        rows_newest.push(ChronRow {
            hash: entry.hash.clone(),
            parents,
            refs,
        });
    }
    let mut as_records: Vec<ChronRow> = rows_newest
        .iter()
        .map(|r| ChronRow {
            hash: r.hash.clone(),
            parents: r.parents.clone(),
            refs: r.refs.clone(),
        })
        .collect();
    ensure_branch_refs_for_gitgraph_import(&mut as_records);
    as_records.reverse();
    as_records
}

fn get_branches_map_from_refs(
    chron: &[ChronRow],
    commit_per_name: &HashMap<String, String>,
) -> HashMap<String, HashSet<String>> {
    let commits_by_hash: HashMap<String, &ChronRow> =
        chron.iter().map(|c| (c.hash.clone(), c)).collect();
    let mut result: HashMap<String, HashSet<String>> = HashMap::new();
    let branch_names: Vec<String> = commit_per_name
        .keys()
        .filter(|n| *n != "HEAD")
        .cloned()
        .collect();

    for branch in branch_names {
        let commit_hash = match commit_per_name.get(&branch) {
            Some(h) => h.clone(),
            None => continue,
        };
        let mut visited: HashSet<String> = HashSet::new();
        let mut queue = vec![commit_hash];
        while let Some(current_hash) = queue.pop() {
            if visited.contains(&current_hash) {
                continue;
            }
            visited.insert(current_hash.clone());
            let entry = result.entry(current_hash.clone()).or_insert_with(HashSet::new);
            entry.insert(branch.clone());
            if let Some(current) = commits_by_hash.get(&current_hash) {
                if let Some(p) = current.parents.first() {
                    queue.push(p.clone());
                }
            }
        }
    }
    result
}

fn compute_reachable_unassociated_commits(
    chron: &[ChronRow],
    branches: &HashMap<String, HashSet<String>>,
) -> HashSet<String> {
    let commits_by_hash: HashMap<String, &ChronRow> =
        chron.iter().map(|c| (c.hash.clone(), c)).collect();
    let unassociated: HashSet<String> = chron
        .iter()
        .filter(|c| !branches.contains_key(&c.hash))
        .map(|c| c.hash.clone())
        .collect();

    let mut tips: Vec<&ChronRow> = Vec::new();
    for commit in chron {
        if commit.parents.len() > 1 {
            for parent_hash in commit.parents.iter().skip(1) {
                if let Some(p) = commits_by_hash.get(parent_hash) {
                    tips.push(p);
                }
            }
        }
    }

    let mut reachable = HashSet::new();
    for tip in tips {
        let mut seen: HashSet<String> = HashSet::new();
        let mut current = Some(tip);
        while let Some(c) = current {
            if !unassociated.contains(&c.hash) {
                break;
            }
            if seen.contains(&c.hash) {
                break;
            }
            seen.insert(c.hash.clone());
            reachable.insert(c.hash.clone());
            let next_hash = c.parents.first().cloned();
            current = next_hash.as_ref().and_then(|h| commits_by_hash.get(h).copied());
        }
    }
    reachable
}

fn resolve_current_branch_name(
    entries_newest_first: &[GitLogEntryIn],
    commit_per_name: &HashMap<String, String>,
) -> Option<String> {
    for entry in entries_newest_first {
        if let Some(name) = parse_current_branch_from_decorations(&entry.decorations) {
            return Some(name);
        }
    }
    for entry in entries_newest_first {
        let mut refs = parse_git_decoration_refs(&entry.decorations);
        refs.sort_by(|a, b| compare_gitgraph_branch_names(a, b));
        for ref_name in refs {
            if is_git_branch_ref_name(&ref_name) {
                return Some(ref_name);
            }
        }
    }
    let mut names: Vec<String> = commit_per_name
        .keys()
        .filter(|name| is_git_branch_ref_name(name))
        .cloned()
        .collect();
    names.sort_by(|a, b| compare_gitgraph_branch_names(a, b));
    names.into_iter().next()
}

fn branch_to_display(
    hash: &str,
    branches: &HashMap<String, HashSet<String>>,
    preferred_branch: Option<&str>,
) -> String {
    let set = match branches.get(hash) {
        Some(s) if !s.is_empty() => s,
        _ => return String::new(),
    };
    if let Some(preferred) = preferred_branch {
        let preferred = preferred.trim();
        if !preferred.is_empty() && set.contains(preferred) {
            return preferred.to_string();
        }
    }
    let mut sorted: Vec<&String> = set.iter().collect();
    sorted.sort_by(|a, b| compare_gitgraph_branch_names(a, b));
    sorted.first().map(|s| (*s).clone()).unwrap_or_default()
}

struct ChronGraphCore {
    chron: Vec<ChronRow>,
    commit_per_name: HashMap<String, String>,
    branches: HashMap<String, HashSet<String>>,
    display_by_hash: HashMap<String, String>,
    current_branch: Option<String>,
}

fn build_chron_graph_core(
    entries_newest_first: &[GitLogEntryIn],
    connectivity: &GraphEdgeConnectivity,
) -> Option<ChronGraphCore> {
    if entries_newest_first.is_empty() {
        return None;
    }
    let chron = build_chronological_rows(entries_newest_first, connectivity);
    let mut commit_per_name: HashMap<String, String> = HashMap::new();
    for c in &chron {
        for ref_name in &c.refs {
            if !ref_name.starts_with(TAG_PREFIX) {
                commit_per_name.insert(ref_name.clone(), c.hash.clone());
            }
        }
    }
    let current_branch = resolve_current_branch_name(entries_newest_first, &commit_per_name);
    let branches = get_branches_map_from_refs(&chron, &commit_per_name);
    let mut display_by_hash: HashMap<String, String> = HashMap::new();
    for c in &chron {
        display_by_hash.insert(
            c.hash.clone(),
            branch_to_display(&c.hash, &branches, current_branch.as_deref()),
        );
    }
    Some(ChronGraphCore {
        chron,
        commit_per_name,
        branches,
        display_by_hash,
        current_branch,
    })
}

fn sorted_unique_display_branch_names(
    entries_newest_first: &[GitLogEntryIn],
    display_by_hash: &HashMap<String, String>,
) -> Vec<String> {
    let mut unique: HashSet<String> = HashSet::new();
    for e in entries_newest_first {
        unique.insert(display_by_hash.get(&e.hash).cloned().unwrap_or_default());
    }
    let mut v: Vec<String> = unique.into_iter().collect();
    v.sort_by(|a, b| compare_gitgraph_branch_names(a, b));
    v
}

fn badge_refs_map_from_core(
    chron: &[ChronRow],
    branches: &HashMap<String, HashSet<String>>,
) -> HashMap<String, Vec<String>> {
    let mut out = HashMap::new();
    for c in chron {
        let list = branches
            .get(&c.hash)
            .map(|set| {
                let mut v: Vec<String> = set.iter().cloned().collect();
                v.sort_by(|a, b| compare_gitgraph_branch_names(a, b));
                v
            })
            .unwrap_or_default();
        out.insert(c.hash.clone(), list);
    }
    out
}

fn branch_color_by_name_from_core(
    entries_newest_first: &[GitLogEntryIn],
    core: &ChronGraphCore,
    palette: &[String],
) -> HashMap<String, String> {
    let reachable = compute_reachable_unassociated_commits(&core.chron, &core.branches);
    let mut names: HashSet<String> = HashSet::new();

    for c in &core.chron {
        if !core.branches.contains_key(&c.hash) && !reachable.contains(&c.hash) {
            continue;
        }
        let d = branch_to_display(&c.hash, &core.branches, core.current_branch.as_deref());
        if !d.is_empty() {
            names.insert(d);
        }
    }

    for name in core.commit_per_name.keys() {
        if name != "HEAD" && !name.starts_with(TAG_PREFIX) {
            names.insert(name.clone());
        }
    }

    for e in entries_newest_first {
        for r in parse_git_decoration_refs(&e.decorations) {
            let t = r.trim();
            if t.to_lowercase().starts_with(TAG_PREFIX) {
                names.insert(t.to_string());
            }
        }
    }

    let mut out: HashMap<String, String> = HashMap::new();
    for name in names {
        let color = palette_color_for_branch_name(&name, palette);
        out.insert(name.clone(), color);
    }
    out
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitLogFileGraphContextOut {
    pub template_signature: String,
    pub template_branch_colors: Vec<String>,
    pub display_by_hash: Vec<HashEntry>,
    pub branch_color_by_name: Vec<HashEntryColor>,
    pub badge_refs_by_hash: Vec<BadgeRefsEntry>,
    pub graph_edge_connectivity: String,
}

#[derive(serde::Serialize)]
pub struct HashEntry {
    pub hash: String,
    pub branch: String,
}

#[derive(serde::Serialize)]
pub struct HashEntryColor {
    pub name: String,
    pub color: String,
}

#[derive(serde::Serialize)]
pub struct BadgeRefsEntry {
    pub hash: String,
    pub refs: Vec<String>,
}

fn default_branch_palette() -> Vec<String> {
    GRUVBOX_BRANCH_PALETTE_HEAT_INDICES
        .iter()
        .map(|&i| gruvbox_heatmap_css_var(i))
        .collect()
}

pub fn build_git_log_file_graph_json(
    entries_json: &str,
    connectivity: &str,
    palette_json: Option<&str>,
) -> Result<String, String> {
    let entries: Vec<GitLogEntryIn> =
        serde_json::from_str(entries_json).map_err(|e| e.to_string())?;
    let conn = GraphEdgeConnectivity::from_str(connectivity);

    let palette: Vec<String> = if let Some(pj) = palette_json {
        serde_json::from_str(pj).unwrap_or_else(|_| default_branch_palette())
    } else {
        default_branch_palette()
    };

    let core = match build_chron_graph_core(&entries, &conn) {
        Some(c) => c,
        None => {
            return Ok("null".to_string());
        }
    };

    if palette.is_empty() {
        let sorted_names = sorted_unique_display_branch_names(&entries, &core.display_by_hash);
        let sig = sorted_names.join("\0");
        let template_branch_colors: Vec<String> = sorted_names
            .iter()
            .map(|_| gruvbox_graph_fallback_stroke())
            .collect();
        let display_by_hash: Vec<HashEntry> = entries
            .iter()
            .map(|e| HashEntry {
                hash: e.hash.clone(),
                branch: core.display_by_hash.get(&e.hash).cloned().unwrap_or_default(),
            })
            .collect();
        let badge_refs = badge_refs_map_from_core(&core.chron, &core.branches);
        let badge_refs_by_hash: Vec<BadgeRefsEntry> = entries
            .iter()
            .map(|e| BadgeRefsEntry {
                hash: e.hash.clone(),
                refs: badge_refs.get(&e.hash).cloned().unwrap_or_default(),
            })
            .collect();

        let out = GitLogFileGraphContextOut {
            template_signature: sig,
            template_branch_colors,
            display_by_hash,
            branch_color_by_name: Vec::new(),
            badge_refs_by_hash,
            graph_edge_connectivity: connectivity.to_string(),
        };
        return serde_json::to_string(&out).map_err(|e| e.to_string());
    }

    let sorted_names = sorted_unique_display_branch_names(&entries, &core.display_by_hash);
    let template_signature = sorted_names.join("\0");
    let template_branch_colors: Vec<String> = sorted_names
        .iter()
        .map(|n| {
            if n.is_empty() {
                gruvbox_graph_fallback_stroke()
            } else {
                palette_color_for_branch_name(n, &palette)
            }
        })
        .collect();

    let bcm = branch_color_by_name_from_core(&entries, &core, &palette);
    let branch_color_by_name: Vec<HashEntryColor> = bcm
        .iter()
        .map(|(name, color)| HashEntryColor {
            name: name.clone(),
            color: color.clone(),
        })
        .collect();

    let display_by_hash: Vec<HashEntry> = entries
        .iter()
        .map(|e| HashEntry {
            hash: e.hash.clone(),
            branch: core.display_by_hash.get(&e.hash).cloned().unwrap_or_default(),
        })
        .collect();

    let badge_refs = badge_refs_map_from_core(&core.chron, &core.branches);
    let badge_refs_by_hash: Vec<BadgeRefsEntry> = entries
        .iter()
        .map(|e| BadgeRefsEntry {
            hash: e.hash.clone(),
            refs: badge_refs.get(&e.hash).cloned().unwrap_or_default(),
        })
        .collect();

    let out = GitLogFileGraphContextOut {
        template_signature,
        template_branch_colors,
        display_by_hash,
        branch_color_by_name,
        badge_refs_by_hash,
        graph_edge_connectivity: connectivity.to_string(),
    };
    serde_json::to_string(&out).map_err(|e| e.to_string())
}
