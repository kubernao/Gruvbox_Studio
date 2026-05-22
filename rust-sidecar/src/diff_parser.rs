//! Unified diff parsing — ports `diffParser.ts`.

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffRow {
    #[serde(rename = "type")]
    pub row_type: String,
    pub left_line_no: Option<i32>,
    pub right_line_no: Option<i32>,
    pub left_text: Option<String>,
    pub right_text: Option<String>,
    pub change_block_id: Option<i32>,
    pub collapsed_side: Option<String>,
    pub collapsed_span: Option<i32>,
    pub collapsed_skip: Option<bool>,
    pub omitted_count: Option<i32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeBlock {
    pub id: i32,
    pub first_row_idx: usize,
    pub last_row_idx: usize,
}

#[derive(Debug, Clone, Copy)]
enum RawLineType {
    Context,
    Del,
    Ins,
    Separator,
}

#[derive(Debug, Clone)]
struct RawLine {
    kind: RawLineType,
    left_line_no: i32,
    right_line_no: i32,
    text: String,
}

/// Parses unified diff text into side-by-side rows (same algorithm as TS `parseUnifiedDiff`).
pub fn parse_unified_diff(diff_text: &str) -> Vec<DiffRow> {
    let mut raw_lines: Vec<RawLine> = Vec::new();
    let mut left_line_no = 0i32;
    let mut right_line_no = 0i32;
    let mut in_hunk = false;
    let mut first_file = true;

    for line in diff_text.split('\n') {
        if line.starts_with("diff --git ") {
            in_hunk = false;
            if !first_file {
                raw_lines.push(RawLine {
                    kind: RawLineType::Separator,
                    left_line_no: 0,
                    right_line_no: 0,
                    text: String::new(),
                });
            }
            first_file = false;
            continue;
        }

        if line.starts_with("index ")
            || line.starts_with("--- ")
            || line.starts_with("+++ ")
            || line.starts_with("new file mode")
            || line.starts_with("deleted file mode")
            || line.starts_with("Binary files")
            || line.starts_with("old mode")
            || line.starts_with("new mode")
        {
            continue;
        }

        if line.starts_with("@@ ") {
            if let Some((l, r)) = parse_hunk_header(line) {
                left_line_no = l;
                right_line_no = r;
                in_hunk = true;
            }
            continue;
        }

        if !in_hunk {
            continue;
        }

        if let Some(rest) = line.strip_prefix(' ') {
            left_line_no += 1;
            right_line_no += 1;
            raw_lines.push(RawLine {
                kind: RawLineType::Context,
                left_line_no,
                right_line_no,
                text: rest.to_string(),
            });
        } else if let Some(rest) = line.strip_prefix('-') {
            left_line_no += 1;
            raw_lines.push(RawLine {
                kind: RawLineType::Del,
                left_line_no,
                right_line_no,
                text: rest.to_string(),
            });
        } else if let Some(rest) = line.strip_prefix('+') {
            right_line_no += 1;
            raw_lines.push(RawLine {
                kind: RawLineType::Ins,
                left_line_no,
                right_line_no,
                text: rest.to_string(),
            });
        }
    }

    build_side_by_side_rows(raw_lines)
}

fn parse_hunk_header(line: &str) -> Option<(i32, i32)> {
    // @@ -L,N +L,N @@
    let rest = line.strip_prefix("@@ ")?;
    let end = rest.find(" @@")?;
    let mid = rest.get(..end)?;
    let parts: Vec<&str> = mid.split_whitespace().collect();
    if parts.len() < 2 {
        return None;
    }
    let left = parse_range(parts[0].strip_prefix('-')?);
    let right = parse_range(parts[1].strip_prefix('+')?);
    Some((left - 1, right - 1))
}

fn parse_range(s: &str) -> i32 {
    let num = s.split(',').next().unwrap_or(s);
    num.parse().unwrap_or(1)
}

fn build_side_by_side_rows(raw_lines: Vec<RawLine>) -> Vec<DiffRow> {
    let mut result: Vec<DiffRow> = Vec::new();
    let mut change_block_id = 0i32;
    let mut i = 0usize;
    const COLLAPSE_VISIBLE: usize = 2;

    while i < raw_lines.len() {
        let line = &raw_lines[i];

        match line.kind {
            RawLineType::Separator => {
                result.push(DiffRow {
                    row_type: "separator".to_string(),
                    left_line_no: None,
                    right_line_no: None,
                    left_text: None,
                    right_text: None,
                    change_block_id: None,
                    collapsed_side: None,
                    collapsed_span: None,
                    collapsed_skip: None,
                    omitted_count: None,
                });
                i += 1;
                continue;
            }
            RawLineType::Context => {
                result.push(DiffRow {
                    row_type: "context".to_string(),
                    left_line_no: Some(line.left_line_no),
                    right_line_no: Some(line.right_line_no),
                    left_text: Some(line.text.clone()),
                    right_text: Some(line.text.clone()),
                    change_block_id: None,
                    collapsed_side: None,
                    collapsed_span: None,
                    collapsed_skip: None,
                    omitted_count: None,
                });
                i += 1;
                continue;
            }
            _ => {}
        }

        let mut dels: Vec<RawLine> = Vec::new();
        let mut ins: Vec<RawLine> = Vec::new();

        while i < raw_lines.len() && matches!(raw_lines[i].kind, RawLineType::Del) {
            dels.push(raw_lines[i].clone());
            i += 1;
        }
        while i < raw_lines.len() && matches!(raw_lines[i].kind, RawLineType::Ins) {
            ins.push(raw_lines[i].clone());
            i += 1;
        }

        if dels.is_empty() && ins.is_empty() {
            i += 1;
            continue;
        }

        let block_id = change_block_id;
        change_block_id += 1;
        let max_len = dels.len().max(ins.len());

        let is_pure_del = !dels.is_empty() && ins.is_empty();
        let is_pure_ins = !ins.is_empty() && dels.is_empty();

        if (is_pure_del || is_pure_ins) && max_len > COLLAPSE_VISIBLE {
            let keep = 1usize;
            let omitted = max_len.saturating_sub(keep * 2);

            for j in 0..max_len {
                if is_pure_del {
                    let del = &dels[j];
                    let in_omitted = j >= keep && j < keep + omitted;
                    let is_start = j == keep && omitted > 0;
                    let mut row = DiffRow {
                        row_type: "del".to_string(),
                        left_line_no: Some(del.left_line_no),
                        right_line_no: None,
                        left_text: Some(del.text.clone()),
                        right_text: None,
                        change_block_id: Some(block_id),
                        collapsed_side: None,
                        collapsed_span: None,
                        collapsed_skip: None,
                        omitted_count: None,
                    };
                    if in_omitted {
                        row.collapsed_side = Some("right".to_string());
                        row.omitted_count = Some(omitted as i32);
                        if is_start {
                            row.collapsed_span = Some(omitted as i32);
                        } else {
                            row.collapsed_skip = Some(true);
                        }
                    }
                    result.push(row);
                } else {
                    let addition = &ins[j];
                    let in_omitted = j >= keep && j < keep + omitted;
                    let is_start = j == keep && omitted > 0;
                    let mut row = DiffRow {
                        row_type: "ins".to_string(),
                        left_line_no: None,
                        right_line_no: Some(addition.right_line_no),
                        left_text: None,
                        right_text: Some(addition.text.clone()),
                        change_block_id: Some(block_id),
                        collapsed_side: None,
                        collapsed_span: None,
                        collapsed_skip: None,
                        omitted_count: None,
                    };
                    if in_omitted {
                        row.collapsed_side = Some("left".to_string());
                        row.omitted_count = Some(omitted as i32);
                        if is_start {
                            row.collapsed_span = Some(omitted as i32);
                        } else {
                            row.collapsed_skip = Some(true);
                        }
                    }
                    result.push(row);
                }
            }
        } else {
            for j in 0..max_len {
                let del = dels.get(j);
                let addition = ins.get(j);

                match (del, addition) {
                    (Some(d), Some(a)) => {
                        result.push(DiffRow {
                            row_type: "change".to_string(),
                            left_line_no: Some(d.left_line_no),
                            right_line_no: Some(a.right_line_no),
                            left_text: Some(d.text.clone()),
                            right_text: Some(a.text.clone()),
                            change_block_id: Some(block_id),
                            collapsed_side: None,
                            collapsed_span: None,
                            collapsed_skip: None,
                            omitted_count: None,
                        });
                    }
                    (Some(d), None) => {
                        result.push(DiffRow {
                            row_type: "del".to_string(),
                            left_line_no: Some(d.left_line_no),
                            right_line_no: None,
                            left_text: Some(d.text.clone()),
                            right_text: None,
                            change_block_id: Some(block_id),
                            collapsed_side: None,
                            collapsed_span: None,
                            collapsed_skip: None,
                            omitted_count: None,
                        });
                    }
                    (None, Some(a)) => {
                        result.push(DiffRow {
                            row_type: "ins".to_string(),
                            left_line_no: None,
                            right_line_no: Some(a.right_line_no),
                            left_text: None,
                            right_text: Some(a.text.clone()),
                            change_block_id: Some(block_id),
                            collapsed_side: None,
                            collapsed_span: None,
                            collapsed_skip: None,
                            omitted_count: None,
                        });
                    }
                    (None, None) => {}
                }
            }
        }
    }

    result
}

/// Rebuilds change block index from diff rows.
pub fn build_change_blocks(diff_rows: &[DiffRow]) -> Vec<ChangeBlock> {
    let mut blocks: Vec<ChangeBlock> = Vec::new();
    let mut current: Option<ChangeBlock> = None;

    for (idx, row) in diff_rows.iter().enumerate() {
        if let Some(cid) = row.change_block_id {
            match &mut current {
                None => {
                    current = Some(ChangeBlock {
                        id: cid,
                        first_row_idx: idx,
                        last_row_idx: idx,
                    });
                }
                Some(cb) if cb.id != cid => {
                    blocks.push(cb.clone());
                    current = Some(ChangeBlock {
                        id: cid,
                        first_row_idx: idx,
                        last_row_idx: idx,
                    });
                }
                Some(cb) => {
                    cb.last_row_idx = idx;
                }
            }
        } else if let Some(cb) = current.take() {
            blocks.push(cb);
        }
    }
    if let Some(cb) = current {
        blocks.push(cb);
    }
    blocks
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn simple_diff() {
        let s = "diff --git a/test.txt b/test.txt
index 1234567..abcdefg 100644
--- a/test.txt
+++ b/test.txt
@@ -1,3 +1,3 @@
 line 1
-line 2
+line 2 modified
 line 3";
        let rows = parse_unified_diff(s);
        assert!(!rows.is_empty());
        let blocks = build_change_blocks(&rows);
        assert!(!blocks.is_empty() || rows.iter().any(|r| r.row_type == "change"));
    }
}
