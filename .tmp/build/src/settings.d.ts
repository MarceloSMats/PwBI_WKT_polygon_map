import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";
import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsSlice = formattingSettings.Slice;
import FormattingSettingsModel = formattingSettings.Model;
export declare class MapConfigCardSettings extends FormattingSettingsCard {
    name: string;
    displayName: string;
    basemap: formattingSettings.AutoDropdown;
    customStyleUrl: formattingSettings.TextInput;
    autoFit: formattingSettings.ToggleSwitch;
    invertCoordinates: formattingSettings.ToggleSwitch;
    slices: Array<FormattingSettingsSlice>;
}
export declare class PolygonConfigCardSettings extends FormattingSettingsCard {
    name: string;
    displayName: string;
    defaultFillColor: formattingSettings.ColorPicker;
    fillOpacity: formattingSettings.NumUpDown;
    strokeColor: formattingSettings.ColorPicker;
    strokeWidth: formattingSettings.NumUpDown;
    strokeOpacity: formattingSettings.NumUpDown;
    highlightColor: formattingSettings.ColorPicker;
    unselectedOpacity: formattingSettings.NumUpDown;
    slices: Array<FormattingSettingsSlice>;
}
export declare class TooltipConfigCardSettings extends FormattingSettingsCard {
    name: string;
    displayName: string;
    showTooltip: formattingSettings.ToggleSwitch;
    showWktInTooltip: formattingSettings.ToggleSwitch;
    slices: Array<FormattingSettingsSlice>;
}
export declare class LayerConfigCardSettings extends FormattingSettingsCard {
    name: string;
    displayName: string;
    showLayerControl: formattingSettings.ToggleSwitch;
    autoFitOnToggle: formattingSettings.ToggleSwitch;
    slices: Array<FormattingSettingsSlice>;
}
export declare class WmsConfigCardSettings extends FormattingSettingsCard {
    name: string;
    displayName: string;
    enabled: formattingSettings.ToggleSwitch;
    serviceType: formattingSettings.AutoDropdown;
    layerTitle: formattingSettings.TextInput;
    url: formattingSettings.TextInput;
    layerName: formattingSettings.TextInput;
    opacity: formattingSettings.NumUpDown;
    wmsFormat: formattingSettings.AutoDropdown;
    wmsTransparent: formattingSettings.ToggleSwitch;
    wmsVersion: formattingSettings.AutoDropdown;
    wfsColor: formattingSettings.ColorPicker;
    wfsStrokeColor: formattingSettings.ColorPicker;
    slices: Array<FormattingSettingsSlice>;
}
export declare class VisualFormattingSettingsModel extends FormattingSettingsModel {
    layerConfig: LayerConfigCardSettings;
    wmsConfig: WmsConfigCardSettings;
    mapConfig: MapConfigCardSettings;
    polygonConfig: PolygonConfigCardSettings;
    tooltipConfig: TooltipConfigCardSettings;
    cards: (LayerConfigCardSettings | WmsConfigCardSettings | MapConfigCardSettings | PolygonConfigCardSettings | TooltipConfigCardSettings)[];
}
