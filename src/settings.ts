"use strict";

import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsSlice = formattingSettings.Slice;
import FormattingSettingsModel = formattingSettings.Model;

export class MapConfigCardSettings extends FormattingSettingsCard {
    name = "mapConfig";
    displayName = "Configurações do Mapa";

    basemap = new formattingSettings.AutoDropdown({
        name: "basemap",
        displayName: "Estilo do Mapa Base",
        value: "carto-light"
    });

    customStyleUrl = new formattingSettings.TextInput({
        name: "customStyleUrl",
        displayName: "URL do Estilo Personalizado",
        placeholder: "https://.../style.json",
        value: ""
    });

    autoFit = new formattingSettings.ToggleSwitch({
        name: "autoFit",
        displayName: "Ajuste Automático de Zoom (Fit)",
        value: true
    });

    invertCoordinates = new formattingSettings.ToggleSwitch({
        name: "invertCoordinates",
        displayName: "Inverter Coordenadas (Lat/Lon)",
        value: false
    });

    renderEngine = new formattingSettings.AutoDropdown({
        name: "renderEngine",
        displayName: "Motor de Renderização",
        value: "canvas"
    });

    smoothFactor = new formattingSettings.NumUpDown({
        name: "smoothFactor",
        displayName: "Simplificação de Linhas",
        value: 1.0
    });

    slices: Array<FormattingSettingsSlice> = [
        this.basemap,
        this.customStyleUrl,
        this.autoFit,
        this.invertCoordinates,
        this.renderEngine,
        this.smoothFactor
    ];
}

export class PolygonConfigCardSettings extends FormattingSettingsCard {
    name = "polygonConfig";
    displayName = "Estilo dos Polígonos";

    defaultFillColor = new formattingSettings.ColorPicker({
        name: "defaultFillColor",
        displayName: "Cor de Preenchimento Padrão",
        value: { value: "#3b82f6" }
    });

    fillOpacity = new formattingSettings.NumUpDown({
        name: "fillOpacity",
        displayName: "Opacidade de Preenchimento (%)",
        value: 60
    });

    strokeColor = new formattingSettings.ColorPicker({
        name: "strokeColor",
        displayName: "Cor da Borda",
        value: { value: "#1d4ed8" }
    });

    strokeWidth = new formattingSettings.NumUpDown({
        name: "strokeWidth",
        displayName: "Espessura da Borda (px)",
        value: 2
    });

    strokeOpacity = new formattingSettings.NumUpDown({
        name: "strokeOpacity",
        displayName: "Opacidade da Borda (%)",
        value: 100
    });

    strokeDashArray = new formattingSettings.AutoDropdown({
        name: "strokeDashArray",
        displayName: "Padrão da Borda",
        value: "solid"
    });

    enableHover = new formattingSettings.ToggleSwitch({
        name: "enableHover",
        displayName: "Destaque ao Passar o Mouse",
        value: true
    });

    hoverStrokeColor = new formattingSettings.ColorPicker({
        name: "hoverStrokeColor",
        displayName: "Cor da Borda no Destaque",
        value: { value: "#2563eb" }
    });

    hoverStrokeWidth = new formattingSettings.NumUpDown({
        name: "hoverStrokeWidth",
        displayName: "Espessura no Destaque (px)",
        value: 3
    });

    hoverFillOpacity = new formattingSettings.NumUpDown({
        name: "hoverFillOpacity",
        displayName: "Opacidade no Destaque (%)",
        value: 80
    });

    highlightColor = new formattingSettings.ColorPicker({
        name: "highlightColor",
        displayName: "Cor de Seleção / Destaque",
        value: { value: "#f59e0b" }
    });

    unselectedOpacity = new formattingSettings.NumUpDown({
        name: "unselectedOpacity",
        displayName: "Opacidade ao Desmarcar (%)",
        value: 25
    });

    slices: Array<FormattingSettingsSlice> = [
        this.defaultFillColor,
        this.fillOpacity,
        this.strokeColor,
        this.strokeWidth,
        this.strokeOpacity,
        this.strokeDashArray,
        this.enableHover,
        this.hoverStrokeColor,
        this.hoverStrokeWidth,
        this.hoverFillOpacity,
        this.highlightColor,
        this.unselectedOpacity
    ];
}

export class TooltipConfigCardSettings extends FormattingSettingsCard {
    name = "tooltipConfig";
    displayName = "Dicas de Ferramenta (Tooltip)";

    showTooltip = new formattingSettings.ToggleSwitch({
        name: "showTooltip",
        displayName: "Exibir Tooltips",
        value: true
    });

    showWktInTooltip = new formattingSettings.ToggleSwitch({
        name: "showWktInTooltip",
        displayName: "Incluir Texto WKT no Tooltip",
        value: false
    });

    slices: Array<FormattingSettingsSlice> = [
        this.showTooltip,
        this.showWktInTooltip
    ];
}

export class LayerConfigCardSettings extends FormattingSettingsCard {
    name = "layerConfig";
    displayName = "Controle de Camadas";

    showLayerControl = new formattingSettings.ToggleSwitch({
        name: "showLayerControl",
        displayName: "Exibir Seletor de Camadas",
        value: true
    });

    autoFitOnToggle = new formattingSettings.ToggleSwitch({
        name: "autoFitOnToggle",
        displayName: "Ajustar Zoom ao Alternar Camadas",
        value: false
    });

    slices: Array<FormattingSettingsSlice> = [
        this.showLayerControl,
        this.autoFitOnToggle
    ];
}

export class WmsConfigCardSettings extends FormattingSettingsCard {
    name = "wmsConfig";
    displayName = "Camada Externa (WMS / WMTS / WFS)";

    enabled = new formattingSettings.ToggleSwitch({
        name: "enabled",
        displayName: "Ativar Camada Externa",
        value: false
    });

    serviceType = new formattingSettings.AutoDropdown({
        name: "serviceType",
        displayName: "Tipo de Serviço",
        value: "wms"
    });

    layerTitle = new formattingSettings.TextInput({
        name: "layerTitle",
        displayName: "Nome de Exibição da Camada",
        placeholder: "Ex: Camada Externa",
        value: "Camada Externa"
    });

    url = new formattingSettings.TextInput({
        name: "url",
        displayName: "Link / URL do Serviço (WMS, WMTS ou WFS)",
        placeholder: "https://.../wmts ou wms ou wfs",
        value: ""
    });

    layerName = new formattingSettings.TextInput({
        name: "layerName",
        displayName: "Nome da Camada (layers / typeName)",
        placeholder: "ex: workspace:camada",
        value: ""
    });

    opacity = new formattingSettings.NumUpDown({
        name: "opacity",
        displayName: "Opacidade (%)",
        value: 80
    });

    wmsFormat = new formattingSettings.AutoDropdown({
        name: "wmsFormat",
        displayName: "Formato de Imagem (WMS)",
        value: "image/png"
    });

    wmsTransparent = new formattingSettings.ToggleSwitch({
        name: "wmsTransparent",
        displayName: "Fundo Transparente (WMS)",
        value: true
    });

    wmsVersion = new formattingSettings.AutoDropdown({
        name: "wmsVersion",
        displayName: "Versão do WMS",
        value: "1.1.1"
    });

    wfsColor = new formattingSettings.ColorPicker({
        name: "wfsColor",
        displayName: "Cor dos Elementos (WFS)",
        value: { value: "#8b5cf6" }
    });

    wfsStrokeColor = new formattingSettings.ColorPicker({
        name: "wfsStrokeColor",
        displayName: "Cor da Borda (WFS)",
        value: { value: "#6d28d9" }
    });

    slices: Array<FormattingSettingsSlice> = [
        this.enabled,
        this.serviceType,
        this.layerTitle,
        this.url,
        this.layerName,
        this.opacity,
        this.wmsFormat,
        this.wmsTransparent,
        this.wmsVersion,
        this.wfsColor,
        this.wfsStrokeColor
    ];
}

export class LabelConfigCardSettings extends FormattingSettingsCard {
    name = "labelConfig";
    displayName = "Rótulos dos Polígonos (Labels)";

    showLabels = new formattingSettings.ToggleSwitch({
        name: "showLabels",
        displayName: "Exibir Rótulos no Mapa",
        value: false
    });

    fontSize = new formattingSettings.NumUpDown({
        name: "fontSize",
        displayName: "Tamanho da Fonte (pt)",
        value: 10
    });

    fontColor = new formattingSettings.ColorPicker({
        name: "fontColor",
        displayName: "Cor do Texto",
        value: { value: "#1e293b" }
    });

    minZoom = new formattingSettings.NumUpDown({
        name: "minZoom",
        displayName: "Zoom Mínimo de Exibição",
        value: 6
    });

    slices: Array<FormattingSettingsSlice> = [
        this.showLabels,
        this.fontSize,
        this.fontColor,
        this.minZoom
    ];
}

export class LodConfigCardSettings extends FormattingSettingsCard {
    name = "lodConfig";
    displayName = "Performance & Zoom Dinâmico (LOD)";

    enableLod = new formattingSettings.ToggleSwitch({
        name: "enableLod",
        displayName: "Ativar LOD (Level of Detail)",
        value: true
    });

    minPixelSize = new formattingSettings.NumUpDown({
        name: "minPixelSize",
        displayName: "Tamanho Mínimo na Tela (px)",
        value: 4
    });

    enableViewportCulling = new formattingSettings.ToggleSwitch({
        name: "enableViewportCulling",
        displayName: "Ocultar Fora da Tela (Culling)",
        value: true
    });

    maxPolygonsOnScreen = new formattingSettings.NumUpDown({
        name: "maxPolygonsOnScreen",
        displayName: "Limite de Polígonos na Tela",
        value: 10000
    });

    autoFetchMore = new formattingSettings.ToggleSwitch({
        name: "autoFetchMore",
        displayName: "Carregamento Contínuo (Streaming)",
        value: true
    });

    maxTotalRows = new formattingSettings.NumUpDown({
        name: "maxTotalRows",
        displayName: "Limite Máximo de Registros",
        value: 100000
    });

    slices: Array<FormattingSettingsSlice> = [
        this.enableLod,
        this.minPixelSize,
        this.enableViewportCulling,
        this.maxPolygonsOnScreen,
        this.autoFetchMore,
        this.maxTotalRows
    ];
}

export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    layerConfig = new LayerConfigCardSettings();
    wmsConfig = new WmsConfigCardSettings();
    mapConfig = new MapConfigCardSettings();
    polygonConfig = new PolygonConfigCardSettings();
    labelConfig = new LabelConfigCardSettings();
    tooltipConfig = new TooltipConfigCardSettings();
    lodConfig = new LodConfigCardSettings();

    cards = [
        this.layerConfig,
        this.wmsConfig,
        this.mapConfig,
        this.polygonConfig,
        this.labelConfig,
        this.tooltipConfig,
        this.lodConfig
    ];
}


