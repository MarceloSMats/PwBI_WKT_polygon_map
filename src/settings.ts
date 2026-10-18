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

    slices: Array<FormattingSettingsSlice> = [
        this.basemap,
        this.customStyleUrl,
        this.autoFit,
        this.invertCoordinates
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
    displayName = "Camada WMS / WFS (Externa)";

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
        placeholder: "Ex: Camada WMS / WFS",
        value: "Camada WMS/WFS"
    });

    url = new formattingSettings.TextInput({
        name: "url",
        displayName: "Link / URL do Serviço (WMS ou WFS)",
        placeholder: "https://.../geoserver/wms ou wfs",
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

export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    layerConfig = new LayerConfigCardSettings();
    wmsConfig = new WmsConfigCardSettings();
    mapConfig = new MapConfigCardSettings();
    polygonConfig = new PolygonConfigCardSettings();
    tooltipConfig = new TooltipConfigCardSettings();

    cards = [
        this.layerConfig,
        this.wmsConfig,
        this.mapConfig,
        this.polygonConfig,
        this.tooltipConfig
    ];
}
