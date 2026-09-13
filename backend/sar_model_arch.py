"""
sar_model_arch.py — model architecture classes for AllenAI's Sentinel-1 vessel
detection models (https://github.com/allenai/vessel-detection-sentinels).

These classes are vendored (adapted, not copy-pasted verbatim) from that repo's
`src/models/frcnn_cmp2.py`, `src/models/frcnn.py` (NoopTransform only), and
`src/models/custom.py`, trimmed to the exact code paths needed to load and run
the two Sentinel-1 checkpoints this backend actually uses:

  - detector:  data/model_artifacts/sentinel-1/frcnn_cmp2/3dff445/best.pth
  - attribute: data/model_artifacts/sentinel-1/attr/c34aa37/best.pth

Their cfg.json for the detector specifies Options without "EncoderBackbone" or
"EncoderBackboneVariant" set, so it uses the default `encoder_backbone="simple"`
path (SimpleBackbone) — the swin-transformer / resnet50 / resnet101 backbone
branches of the original MyBackbone class are NOT reachable by these weights
and have been dropped here to avoid pulling in extra torchvision internals
(IntermediateLayerGetter, Swin_V2_* weights) that this checkpoint never uses.

Upstream code license: Apache-2.0 (repo LICENSE file, checked 2026-08-29).
Model WEIGHTS license: marked "License: TBD" in the upstream model card
(docs/sentinel1_model_card.md) as of 2026-08-29. This is used here for a
real, functional integration per explicit instruction to document rather
than block on that ambiguity — flag for legal review before any production/
commercial use that depends on a settled weights license.
"""

from __future__ import annotations

from collections import OrderedDict

import torch
import torchvision
from torchvision.models.detection.faster_rcnn import FasterRCNN, FastRCNNPredictor
from torchvision.models.detection.image_list import ImageList
from torchvision.models.detection.transform import GeneralizedRCNNTransform
from torchvision.ops.feature_pyramid_network import FeaturePyramidNetwork, LastLevelMaxPool


class NoopTransform(torch.nn.Module):
    """Replaces FasterRCNN's default input normalisation/resize transform with
    a pass-through (the model is trained on raw 0..1-scaled SAR amplitude, not
    ImageNet-normalised RGB, so the default transform would corrupt it)."""

    def __init__(self):
        super().__init__()
        self.transform = GeneralizedRCNNTransform(
            min_size=800, max_size=800, image_mean=[], image_std=[],
        )

    def forward(self, images, targets):
        images = self.transform.batch_images(images, size_divisible=32)
        image_sizes = [(image.shape[1], image.shape[2]) for image in images]
        image_list = ImageList(images, image_sizes)
        return image_list, targets

    def postprocess(self, detections, image_sizes, orig_sizes):
        return detections


class SimpleBackbone(torch.nn.Module):
    """Small custom CNN backbone (not a torchvision stock backbone) — this is
    what the frcnn_cmp2/3dff445 checkpoint was actually trained with."""

    def __init__(self, num_channels: int):
        super().__init__()

        def down_layer(in_channels, out_channels):
            return torch.nn.Sequential(
                torch.nn.Conv2d(in_channels, out_channels, 4, stride=2, padding=1),
                torch.nn.ReLU(inplace=True),
                torch.nn.Conv2d(out_channels, out_channels, 3, padding=1),
                torch.nn.BatchNorm2d(out_channels, eps=1e-3, momentum=0.03),
                torch.nn.ReLU(inplace=True),
            )

        self.down1 = down_layer(num_channels, 32)
        self.down2 = down_layer(32, 64)
        self.down3 = down_layer(64, 128)
        self.down4 = down_layer(128, 256)
        self.down5 = down_layer(256, 512)
        self.features = torch.nn.Sequential(
            torch.nn.Conv2d(512, 512, 3, padding=1),
            torch.nn.ReLU(inplace=True),
            torch.nn.Conv2d(512, 512, 3, padding=1),
            torch.nn.ReLU(inplace=True),
            torch.nn.Conv2d(512, 512, 3, padding=1),
        )

    def forward(self, x):
        down1 = self.down1(x)
        down2 = self.down2(down1)
        down3 = self.down3(down2)
        down4 = self.down4(down3)
        down5 = self.down5(down4)
        features = self.features(down5)
        return {"0": down2, "1": down3, "2": down4, "3": features}


class MyBackbone(torch.nn.Module):
    """FPN wrapper around SimpleBackbone that also accepts extra "overlap"
    channel groups (historical scenes for temporal context). When the input
    tensor only has `group_channels` channels (our case — single scene, no
    historicals), the overlap contribution is a zero tensor, matching the
    upstream model's own fallback behaviour for missing history."""

    def __init__(self, aggregate_op: str = "max", group_channels: int = 2):
        super().__init__()
        self.aggregate_op = aggregate_op
        self.group_channels = group_channels
        self.backbone = SimpleBackbone(self.group_channels)
        encoder_channels = [128, 256, 512, 1024]

        self.out_channels = 256
        self.fpn = FeaturePyramidNetwork(
            in_channels_list=encoder_channels,
            out_channels=self.out_channels,
            extra_blocks=LastLevelMaxPool(),
        )

    def forward(self, x):
        base_im_features = self.backbone(x[:, 0:self.group_channels, :, :])

        overlap_dict: dict = {}
        for i in range(self.group_channels, x.shape[1], self.group_channels):
            overlap_features = self.backbone(x[:, i:i + self.group_channels, :, :])
            for k, v in overlap_features.items():
                if k not in overlap_dict:
                    overlap_dict[k] = v
                elif self.aggregate_op == "sum":
                    overlap_dict[k] = overlap_dict[k] + v
                else:
                    overlap_dict[k] = torch.maximum(overlap_dict[k], v)

        out_dict = {}
        if len(overlap_dict.keys()) == len(base_im_features.keys()):
            for k in base_im_features:
                out_dict[k] = torch.cat([base_im_features[k], overlap_dict[k]], dim=1)
        else:
            for k, v in base_im_features.items():
                blank_history = torch.zeros(
                    size=v.shape, dtype=v.dtype, device=v.device,
                )
                out_dict[k] = torch.cat([v, blank_history], dim=1)

        return self.fpn(out_dict)


class SarDetectorModel(torch.nn.Module):
    """FasterRCNN vessel-point detector — adapted from the upstream repo's
    `frcnn_cmp2.FasterRCNNModel`, restricted to the "simple" encoder-backbone
    path used by the actual 3dff445 checkpoint. Input: uint8 SAR amplitude
    tensor scaled to [0, 1] float, channels = [vh, vv] (2 channels, since we
    run single-scene inference with no historical overlap images)."""

    def __init__(self, cfg: dict, image_size: int, num_classes: int | None = None):
        super().__init__()
        import json as _json

        options = cfg["Options"]
        if num_classes is None:
            # cfg.json's "categories" field (e.g. '["vessel"]') is the nominal
            # class list, but the actual shipped 3dff445/best.pth checkpoint's
            # classifier head has more output classes than this cfg lists
            # (confirmed by inspecting the checkpoint's cls_score shape at
            # load time — a real config/checkpoint drift in the upstream
            # repo). Callers that know the checkpoint's true class count
            # should pass num_classes explicitly (see
            # sar_detector.py::load_models, which infers it from the
            # checkpoint itself before constructing this model).
            num_classes = len(_json.loads(cfg["Data"]["categories"]))

        aggregate_op = options.get("AggregateOp", "max")
        group_channels = options.get("GroupChannels", 2)
        use_noop_transform = options.get("NoopTransform", True)

        box_detections_per_img = max(100, 100 * image_size * image_size // 800 // 800)
        rpn_pre_nms_top_n_train = max(2000, 2000 * image_size * image_size // 800 // 800)
        rpn_post_nms_top_n_train = max(2000, 2000 * image_size * image_size // 800 // 800)
        rpn_pre_nms_top_n_test = max(1000, 1000 * image_size * image_size // 800 // 800)
        rpn_post_nms_top_n_test = max(1000, 1000 * image_size * image_size // 800 // 800)

        self.backbone = MyBackbone(aggregate_op=aggregate_op, group_channels=group_channels)
        self.faster_rcnn = FasterRCNN(
            self.backbone,
            num_classes + 1,
            min_size=image_size,
            max_size=image_size,
            box_detections_per_img=box_detections_per_img,
            rpn_pre_nms_top_n_train=rpn_pre_nms_top_n_train,
            rpn_post_nms_top_n_train=rpn_post_nms_top_n_train,
            rpn_pre_nms_top_n_test=rpn_pre_nms_top_n_test,
            rpn_post_nms_top_n_test=rpn_post_nms_top_n_test,
        )

        in_features = self.faster_rcnn.roi_heads.box_predictor.cls_score.in_features
        self.faster_rcnn.roi_heads.box_predictor = FastRCNNPredictor(in_features, num_classes + 1)

        if use_noop_transform:
            self.faster_rcnn.transform = NoopTransform()

    def forward(self, images):
        """images: list of [C,H,W] float tensors in [0,1]. Returns torchvision
        FasterRCNN detections (list of dicts with boxes/scores/labels), with
        labels shifted back down by 1 (0 is reserved for background upstream)."""
        images, _ = self.faster_rcnn.transform(images, None)
        features = self.faster_rcnn.backbone(images.tensors)
        if isinstance(features, torch.Tensor):
            features = OrderedDict([("0", features)])
        proposals, _ = self.faster_rcnn.rpn(images, features, None)
        detections, _ = self.faster_rcnn.roi_heads(features, proposals, images.image_sizes, None)
        for output in detections:
            output["labels"] = output["labels"] - 1
        return detections


class SarAttributeModel(torch.nn.Module):
    """ResNet-50-based attribute regressor/classifier — adapted from the
    upstream repo's `custom.Model`. Input: a batch of [C,120,120] float crops
    in [0,1] centred on each detected vessel point. Output: a
    [batch, 1+1+16+1+2] tensor = [length, width, 16 heading-bucket logits,
    speed, 2 is-fishing-vessel logits]."""

    def __init__(self, num_channels: int):
        super().__init__()
        self.num_channels = num_channels
        self.resnet = torchvision.models.resnet.resnet50(weights=None)
        self.resnet.conv1 = torch.nn.Conv2d(
            num_channels, self.resnet.conv1.out_channels,
            kernel_size=7, stride=2, padding=3, bias=False,
        )
        self.resnet.fc = torch.nn.Sequential(
            torch.nn.Linear(self.resnet.fc.in_features, 256),
            torch.nn.ReLU(),
            torch.nn.Linear(256, 1 + 1 + 16 + 1 + 2),
        )

    def forward(self, images):
        images = torch.stack(images, dim=0)
        return self.resnet(images)
