# Bundled prompt sources / 内置提示词来源

These files are snapshots of the normalized JSON published by
[yukkcat/image-prompts](https://github.com/yukkcat/image-prompts) (MIT), served from this site so the app
works without reaching GitHub. Prompt text belongs to the original authors under the licenses below.
Cover images are bundled as small WebP thumbnails in covers/ (brand/sync-prompt-covers.mjs downloads them, including X/forum-hosted
ones, and rewrites coverUrl / referenceImageUrls). Records whose image is gone (deleted post, 404) or that upstream tags NSFW are
removed from the snapshot. The app never loads prompt images from external hosts.

| Source | Upstream | License |
| --- | --- | --- |
| 点染精选 (dianran-picks) | this project | MIT |
| X 热门 (x-trending) | public posts on X, see each record's sourceUrl | © each post's author; quoted with attribution |
| Civitai 热门 (civitai-trending) | public Civitai images API (SFW only), see each record's sourceUrl | © each image's creator; shown with attribution per Civitai's Terms |
| YouMind GPT Image 2 | https://github.com/YouMind-OpenLab/awesome-gpt-image-2 | CC BY 4.0 |
| YouMind Nano Banana Pro | https://github.com/YouMind-OpenLab/awesome-nano-banana-pro-prompts | CC BY 4.0 |
| Awesome GPT-4o | https://github.com/ImgEdify/Awesome-GPT4o-Image-Prompts | MIT |
| Banana Prompt Quicker | https://github.com/glidea/banana-prompt-quicker | MIT |
| Freestylefly GPT Image 2 | https://github.com/freestylefly/awesome-gpt-image-2 | MIT |
| Awesome GPT Image | https://github.com/ZeroLu/awesome-gpt-image | MIT |

CC BY 4.0 material: © YouMind OpenLab, https://creativecommons.org/licenses/by/4.0/ — records were normalized
(field mapping only) by yukkcat/image-prompts. No endorsement by the licensors is implied.

x-trending.json is curated by hand from public X posts (2026-08-04 to 2026-10-04, ranked by likes). Every record keeps the
author handle, the original post URL and the post date, and the app shows that attribution on the prompt detail. Prompt text is
quoted verbatim; rights stay with the authors. Ask us to remove a record at any time.

Since 2026-10 x-trending and civitai-trending are refreshed weekly by brand/pipeline/run-weekly.sh (X via twscrape keyword +
watchlist searches; Civitai via its public REST API, most reactions of the week, nsfw=None, prompt shared by the creator). Every
record keeps author, post/image URL, post date and engagement numbers; the app links back to the original. Real-person likeness,
NSFW and face-swap prompts are filtered out. 点染精选 (dianran-picks) is rebuilt from the top-scored records of all libraries.
