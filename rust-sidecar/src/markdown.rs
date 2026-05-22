//! Markdown → sanitized HTML — ports `markdownPreviewHtml.ts`.
//!
//! Parser options mirror the TS `marked` path where pulldown-cmark supports them.
//! `marked` uses `breaks: true` (single newlines become `<br>`); pulldown-cmark has no
//! identical option, so line-break behavior may still differ for the Rust-only path.

use ammonia::Builder;
use pulldown_cmark::{html, Options, Parser};
use std::collections::HashSet;

pub fn render_markdown(source: &str) -> String {
    let mut opts = Options::empty();
    opts.insert(Options::ENABLE_STRIKETHROUGH);
    opts.insert(Options::ENABLE_TABLES);
    opts.insert(Options::ENABLE_FOOTNOTES);
    opts.insert(Options::ENABLE_TASKLISTS);
    opts.insert(Options::ENABLE_SMART_PUNCTUATION);

    let parser = Parser::new_ext(source, opts);
    let mut unsafe_html = String::new();
    html::push_html(&mut unsafe_html, parser);

    let mut builder = Builder::default();
    builder.add_tags(&[
        "input", "img", "h1", "h2", "h3", "h4", "h5", "h6", "pre", "code", "span", "br", "del",
        "table", "thead", "tbody", "tr", "th", "td",
    ]);
    builder.add_generic_attributes(&["class"]);
    // Do not whitelist `rel` on `<a>` while `link_rel` is set: ammonia merges link_rel and panics if
    // both are configured (see ammonia clean_dom assertions).
    builder.add_tag_attributes("a", &["href", "name", "target"]);
    builder.add_tag_attributes("img", &["src", "alt", "title"]);
    builder.add_tag_attributes("th", &["colspan", "rowspan", "align"]);
    builder.add_tag_attributes("td", &["colspan", "rowspan", "align"]);
    builder.add_tag_attributes("input", &["type", "checked", "disabled"]);
    builder.url_schemes(HashSet::from(["http", "https", "mailto", "data"]));
    builder.link_rel(Some("noopener noreferrer"));

    builder.clean(&unsafe_html).to_string()
}
