# Background-removal model audit

Checked 23 October 2026. Research and source inspection only; application code and dependencies were not changed. No candidate was benchmarked on a physical webcam or through a live broadcast.

## Current implementation

| Path | Runtime and model | What it does |
| --- | --- | --- |
| Camera blur and image replacement | Installed `@livekit/track-processors` 0.8.1, depending on `@mediapipe/tasks-vision` 0.10.14; default SelfieSegmenter square, float16, 256 × 256 | `apps/web/src/devices.ts` selects `StableBackgroundProcessor`. Its custom transformer uses confidence masks and the GPU temporal filter in `apps/web/src/background-mask.ts`. |
| Experimental Person only camera mode | Same runtime; SelfieMulticlass, float32, 256 × 256 | `apps/web/src/background-processor.ts` overrides the model URL and excludes background and accessory classes. This does not reconstruct clothing or skin hidden by an object. |
| Screen + cutout presenter | Direct `@mediapipe/tasks-vision` 0.10.14 with matching 0.10.14 CDN WASM; SelfieSegmenter square | `packages/studio/src/foreground.ts` segments decoded video in the studio and outgoing renderer. It uses confidence masks but does not use the camera path's temporal filter. |

The installed package symlinks and `bun.lock` agree on these versions. Although `apps/web/package.json` requests `latest` for LiveKit, the lockfile currently resolves 0.8.1. `packages/studio/package.json` explicitly pins MediaPipe to 0.10.14.

## Are the models current?

**The configured weights are current for these Google model families; the software packages are not current.** Google's [current model catalog](https://developers.google.com/edge/mediapipe/solutions/vision/image_segmenter) still lists square and landscape SelfieSegmenter and the 256 × 256 SelfieMulticlass model. Both models used here are fetched through Google's `latest` paths.

Public Google Storage HEAD requests confirmed that `latest` and version `1` return matching size, ETag, and CRC32C metadata:

| Model | Bytes | ETag for both aliases | CRC32C | Latest object's Last-Modified |
| --- | ---: | --- | --- | --- |
| SelfieSegmenter square | 249,537 | `3b2e3e1cfc7d31538caf00ff4e0fba8c` | `/fhgOA==` | 7 May 2023 |
| SelfieMulticlass | 16,371,837 | `6ca6a40d84bcb910420a1a43a295100a` | `h2OU6w==` | 26 April 2023 |

Compared endpoints:

- [SelfieSegmenter latest](https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite) and [version 1](https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite).
- [SelfieMulticlass latest](https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite) and [version 1](https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/1/selfie_multiclass_256x256.tflite).

This verifies the public assets requested by the source. It does not inspect an already-open browser's cached model or the deployed production bundle.

## Available software updates

Public npm registry metadata was checked directly, alongside the release sources:

| Package | Installed | Current stable | Finding |
| --- | --- | --- | --- |
| `@livekit/track-processors` | 0.8.1 | 0.8.2, published 12 October 2026 | The [release](https://github.com/livekit/track-processors-js/releases/tag/v0.8.2) reduces GPU work for blur, mask feathering, blending, and static background uploads. These are processing changes, not new trained weights. |
| `@mediapipe/tasks-vision` | 0.10.14 | 1.1.1, published 14 October 2026 | The [package listing](https://www.npmjs.com/package/%40mediapipe/tasks-vision?activeTab=versions) and npm registry agree. The current nightly tag is `1.2.0-rc.20261021`; it is not the stable recommendation. |

The [LiveKit 0.8.2 package](https://github.com/livekit/track-processors-js/blob/v0.8.2/package.json) still depends on MediaPipe **0.10.14**. Updating LiveKit alone will not update that runtime. A newer MediaPipe experiment must update its JavaScript and WASM together and verify the custom transformer; a global dependency override is not a demonstrated compatibility fix.

## Roboflow search results

These are evaluation candidates, not measured improvements over our pipeline. Instance masks identify object regions; they do not by themselves establish soft hair alpha or stable motion boundaries.

| Candidate | Evidence | Assessment for this studio |
| --- | --- | --- |
| **RF-DETR Segmentation Nano / Small** | The [official repository](https://github.com/roboflow/rf-detr#segmentation) lists the Nano–2XL segmentation family, Apache 2.0 licensing, and Python/Inference usage. The [Playground page](https://playground.roboflow.com/models/roboflow/rf-detr-segmentation) describes the full family released in January 2026. | First Roboflow candidate I would benchmark. Use person masks and compare outlines, hair, hand motion, and total processing delay. It needs a new inference integration; its published GPU timings do not establish browser performance. |
| **SAM2 RT Tiny / Small** | [Roboflow documentation](https://inference-models.roboflow.com/models/sam2-rt-video-tracking/) describes stateful video tracking, initial bounding-box prompts, a CUDA requirement, and self-hosted Python deployment. | Useful if retaining the same presenter across frames is important. A separate GPU inference path and initialization are required. It is not a browser MediaPipe replacement, and the documented adapter is not available through Workflows or its serverless API. |
| **Community `segment-person/1`** | [Universe project](https://universe.roboflow.com/science-of-university/segment-person): 2,188 images, Roboflow 3.0 instance segmentation, December 2023, page-listed CC BY 4.0 dataset license. | A secondary baseline or data source. Its page-reported mAP does not measure hair transparency or temporal quality, and it is not a newer specialist video-matting model. |
| **Roboflow Background Removal workflow** | The [official guide](https://roboflow.com/blog/remove-background-image-computer-vision) combines object localization with box or polygon removal and transparent PNG output. | Useful for still assets and prototyping; the template itself is not a new video-matting model. |

Search results also included [background-removal-v1/1](https://universe.roboflow.com/ahmed1155/background-removal-v1). Its classes concern rebar, so its name does not make it suitable for a presenter cutout. Exclude it from the shortlist.

The current RF-DETR repository and Playground describe the full model family, while the inspected `inference-models` RF-DETR page still focuses on the older preview identifier. Use the full-family repository instructions when preparing an experiment.

## A newer dedicated video-matting option

[MatAnyone 2](https://github.com/pq-yang/MatAnyone2) is a 2026 human video-matting candidate that explicitly targets fine detail and robustness rather than only instance boundaries. Its official implementation takes video plus a first-frame mask and provides Python/CUDA inference. The README specifies the custom NTU S-Lab License 1.0; the linked license file did not resolve during this audit, so its exact deployment permissions remain unverified. It is a separate evaluation project, not a demonstrated browser upgrade or measured live-webcam improvement.

## Recommended order

1. Evaluate LiveKit 0.8.2 with the existing weights and temporal filter. Measure the inherited rendering changes because our transformer overrides the normal per-frame segmentation path.
2. Compare the transparent presenter cutout with the existing camera temporal filter adapted to it. This is a concrete consistency gap in the current code, independent of model age.
3. Test MediaPipe 1.1.1 in isolation, keeping its JavaScript and WASM aligned. Treat the direct presenter path and LiveKit's pinned dependency as separate compatibility decisions.
4. Benchmark RF-DETR Seg Nano/Small against the existing square SelfieSegmenter. If a local GPU service is acceptable, include SAM2 RT and MatAnyone 2 as distinct experiments.

Use the same moving webcam recording for every candidate: stationary hair, fast hand motion, turns, low light, chair edges, and microphone overlap. Record end-to-end frame delay, mask age, effective mask updates per second, edge flicker, GPU/CPU use, and visible hair/skin loss. A 30 FPS path has roughly 33 ms per frame for the whole pipeline. Validate both the camera-effects path and the decoded presenter/egress path before making a live-quality claim.
