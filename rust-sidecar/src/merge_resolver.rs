//! Merge result building — ports `mergeResolver.ts`.

use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DiffRowIn {
    #[serde(rename = "type")]
    row_type: String,
    left_text: Option<String>,
    right_text: Option<String>,
    change_block_id: Option<i32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChangeBlockIn {
    id: i32,
    first_row_idx: usize,
    last_row_idx: usize,
}

/// changeSelections: JSON object map string id -> "left" | "right" | null
pub fn build_merge_result(
    diff_rows_json: &str,
    change_selections_json: &str,
    change_blocks_json: &str,
) -> Result<String, String> {
    let diff_rows: Vec<DiffRowIn> =
        serde_json::from_str(diff_rows_json).map_err(|e| e.to_string())?;
    let change_selections: serde_json::Value =
        serde_json::from_str(change_selections_json).map_err(|e| e.to_string())?;
    let change_blocks: Vec<ChangeBlockIn> =
        serde_json::from_str(change_blocks_json).map_err(|e| e.to_string())?;

    let mut unresolved = 0usize;
    for b in &change_blocks {
        let key = b.id.to_string();
        let sel = change_selections.get(&key).or_else(|| change_selections.get(&format!("{}", b.id)));
        let v = sel.and_then(|x| {
            if x.is_null() {
                None
            } else {
                x.as_str()
            }
        });
        if v.is_none() {
            unresolved += 1;
        }
    }
    if unresolved > 0 {
        return Err(format!(
            "Cannot save: {} unresolved change blocks",
            unresolved
        ));
    }

    let block_by_id: std::collections::HashMap<i32, &ChangeBlockIn> =
        change_blocks.iter().map(|b| (b.id, b)).collect();

    let mut lines: Vec<String> = Vec::new();
    let mut processed = std::collections::HashSet::new();

    for row in &diff_rows {
        if row.row_type == "separator" {
            continue;
        }
        if row.row_type == "context" {
            let line = row
                .left_text
                .clone()
                .or_else(|| row.right_text.clone())
                .unwrap_or_default();
            lines.push(line);
            continue;
        }

        let bid = match row.change_block_id {
            Some(id) => id,
            None => continue,
        };

        if processed.contains(&bid) {
            continue;
        }
        processed.insert(bid);

        let block = match block_by_id.get(&bid) {
            Some(b) => *b,
            None => continue,
        };

        let sel_key = bid.to_string();
        let selection = change_selections
            .get(&sel_key)
            .or_else(|| change_selections.get(&format!("{}", bid)));
        let side = selection
            .and_then(|x| x.as_str())
            .unwrap_or("right");

        let slice = diff_rows
            .get(block.first_row_idx..=block.last_row_idx)
            .ok_or_else(|| "Invalid change block range".to_string())?;

        if side == "left" {
            for br in slice {
                if let Some(t) = &br.left_text {
                    lines.push(t.clone());
                }
            }
        } else {
            for br in slice {
                if let Some(t) = &br.right_text {
                    lines.push(t.clone());
                }
            }
        }
    }

    Ok(lines.join("\n"))
}
