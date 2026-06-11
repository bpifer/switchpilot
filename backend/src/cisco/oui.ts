// OUI (first 6 hex chars of MAC, uppercase, no separators) → vendor name.
// Covers the most common enterprise, consumer, and IoT vendors.
// Source: IEEE OUI database (public).
const OUI: Record<string, string> = {
  // Cisco Systems (networking gear, IP phones, Meraki)
  '001D70': 'Cisco', '001EA6': 'Cisco', '002155': 'Cisco', '0023EA': 'Cisco',
  '002690': 'Cisco', '00270B': 'Cisco', '002A6A': 'Cisco', '003A9A': 'Cisco',
  '1C1D86': 'Cisco', '241805': 'Cisco', '2C3F38': 'Cisco', '3C5731': 'Cisco',
  '485BFF': 'Cisco', '503DE5': 'Cisco', '5404A6': 'Cisco', '6C7009': 'Cisco',
  '840B2D': 'Cisco', '8CEC4B': 'Cisco', 'A0E0AF': 'Cisco', 'B0AAAC': 'Cisco',
  'B4E9B0': 'Cisco', 'C4642B': 'Cisco', 'DC7B94': 'Cisco', 'E8BAE3': 'Cisco',
  'F0025B': 'Cisco', 'F07F06': 'Cisco', 'FC7966': 'Cisco', '001122': 'Cisco',
  '000000': 'Xerox', // historical Xerox/Cisco
  '00000C': 'Cisco', '000143': 'Cisco', '0002FC': 'Cisco', '000216': 'Cisco',
  '000293': 'Cisco', '00030E': 'Cisco', '000369': 'Cisco', '00039F': 'Cisco',
  // Cisco Meraki
  '002706': 'Cisco Meraki', '0C8112': 'Cisco Meraki', '205EE1': 'Cisco Meraki',
  '3497F6': 'Cisco Meraki', '44103B': 'Cisco Meraki', '4C3488': 'Cisco Meraki',
  '882BF0': 'Cisco Meraki', 'CC46D6': 'Cisco Meraki', 'E0CB4E': 'Cisco Meraki',
  '0CE27E': 'Cisco Meraki', '5C5015': 'Cisco Meraki',
  // Apple
  '000A27': 'Apple', '000D93': 'Apple', '001124': 'Apple', '0016CB': 'Apple',
  '001B63': 'Apple', '001D4F': 'Apple', '001E52': 'Apple', '001FC5': 'Apple',
  '0021E9': 'Apple', '002332': 'Apple', '0025BC': 'Apple', '002608': 'Apple',
  '00264B': 'Apple', '003EE1': 'Apple', '28CFE9': 'Apple', '28E02C': 'Apple',
  '3C0754': 'Apple', '3C15C2': 'Apple', '3CEF8C': 'Apple', '60F445': 'Apple',
  '8C7B9D': 'Apple', 'A45E60': 'Apple', 'A860B6': 'Apple', 'AC3C0B': 'Apple',
  'B817C2': 'Apple', 'C82A14': 'Apple', 'D02544': 'Apple', 'E0B9BA': 'Apple',
  'E8B2AC': 'Apple', 'F02475': 'Apple', '0050E4': 'Apple', '3CA29B': 'Apple',
  '78D75F': 'Apple', '98B8E3': 'Apple', 'C86F1D': 'Apple', 'DCF772': 'Apple',
  // Samsung
  '001247': 'Samsung', '001C62': 'Samsung', '0021D1': 'Samsung', '002538': 'Samsung',
  '002716': 'Samsung', '002A15': 'Samsung', '001632': 'Samsung', '1C62B8': 'Samsung',
  '2C0E3D': 'Samsung', '3C62FE': 'Samsung', '3CE4B0': 'Samsung', '48609C': 'Samsung',
  '5CBA37': 'Samsung', '8CE748': 'Samsung', 'A00798': 'Samsung', 'B47C9C': 'Samsung',
  'C4731E': 'Samsung', 'CC07AB': 'Samsung', 'D0176A': 'Samsung', 'D4E8B2': 'Samsung',
  'F025B7': 'Samsung', '00E3B2': 'Samsung',
  // Dell Technologies
  '00065B': 'Dell', '000874': 'Dell', '000BDB': 'Dell', '000D56': 'Dell',
  '0010A4': 'Dell', '0012F0': 'Dell', '0013F3': 'Dell', '0014BF': 'Dell',
  '00188B': 'Dell', '001A4B': 'Dell', '001C23': 'Dell', '001E4F': 'Dell',
  '002170': 'Dell', '002185': 'Dell', '00219B': 'Dell', '0024E8': 'Dell',
  '002564': 'Dell', '002590': 'Dell', '00269E': 'Dell', '0026B9': 'Dell',
  '001D09': 'Dell', '1C40AF': 'Dell', '2CDB07': 'Dell', '50514F': 'Dell',
  'B083FE': 'Dell', 'D067E5': 'Dell', 'EC2864': 'Dell', 'F48E38': 'Dell',
  'FCAA14': 'Dell',
  // HP Inc / HPE
  '0006FE': 'HP', '000B5D': 'HP', '000D9D': 'HP', '001AA8': 'HP',
  '001B78': 'HP', '001E0B': 'HP', '0021F7': 'HP', '002669': 'HP',
  '0030C1': 'HP', '0060B0': 'HP', '080009': 'HP', '1402EC': 'HP',
  '1866DA': 'HP', '2C27D7': 'HP', '3C52A1': 'HP', '9456EE': 'HP',
  'A09B77': 'HP', 'C4346B': 'HP', 'E830D0': 'HP', 'F41B5A': 'HP',
  '78AC44': 'HP', 'B499BA': 'HP',
  // Aruba Networks (HPE Aruba)
  '000B86': 'Aruba', '040C2B': 'Aruba', '084FAB': 'Aruba', '20A6CD': 'Aruba',
  '24DECE': 'Aruba', '6C8814': 'Aruba', '8C1590': 'Aruba', 'BC9CE5': 'Aruba',
  'D85D4C': 'Aruba', 'E86093': 'Aruba', '94B40F': 'Aruba', 'D0037F': 'Aruba',
  // Ubiquiti Networks
  '0418D6': 'Ubiquiti', '18E829': 'Ubiquiti', '244CE7': 'Ubiquiti', '44D9E7': 'Ubiquiti',
  '68722D': 'Ubiquiti', '788A20': 'Ubiquiti', '80AABB': 'Ubiquiti', 'ACCC8E': 'Ubiquiti',
  'B4FBE4': 'Ubiquiti', 'DC9FDB': 'Ubiquiti', 'E063DA': 'Ubiquiti', 'E4956E': 'Ubiquiti',
  'F09FC2': 'Ubiquiti', 'FC7F15': 'Ubiquiti', '002722': 'Ubiquiti',
  // Microsoft
  '000D3A': 'Microsoft', '001DD8': 'Microsoft', '00224E': 'Microsoft',
  '28180E': 'Microsoft', '3044AE': 'Microsoft', '482240': 'Microsoft',
  '7045C4': 'Microsoft', '9CEBE8': 'Microsoft', 'D8535D': 'Microsoft',
  '603300': 'Microsoft', '485073': 'Microsoft',
  // Lenovo
  '000C29': 'VMware', '005056': 'VMware', '001C14': 'VMware',  // VMware virtual
  '00505A': 'IBM', '08003E': 'Motorola', '001EC2': 'Intel',
  '001B21': 'Intel', '286ED4': 'Intel', '8086F2': 'Intel', 'A4C3F0': 'Intel',
  // Broadcom / Realtek (common PC NICs)
  '001018': 'Broadcom', '001A1E': 'Broadcom', '18C086': 'Broadcom',
  '44A842': 'Broadcom', '5C0A5B': 'Broadcom', '88F77C': 'Broadcom',
  'E89D37': 'Broadcom', 'D8B377': 'Realtek', '00E04C': 'Realtek',
  '006B8E': 'Realtek', '4CAD97': 'Realtek', '788CB5': 'Realtek',
  // Axis Communications (cameras)
  '00408C': 'Axis', 'B8A44E': 'Axis', 'D4F521': 'Axis',
  // Hikvision (cameras)
  'C8F740': 'Hikvision', 'BC3400': 'Hikvision', '4C1844': 'Hikvision',
  '280CDB': 'Hikvision', 'A40C66': 'Hikvision',
  // Dahua Technology (cameras)
  'E0507A': 'Dahua', '3CF7A4': 'Dahua',
  // Zebra Technologies (barcode scanners)
  '001A8C': 'Zebra', '0C8268': 'Zebra', '2478D1': 'Zebra', '40831D': 'Zebra',
  '74E24D': 'Zebra', 'A0B2C8': 'Zebra',
  // Honeywell (building systems, scanners)
  '000EB0': 'Honeywell', '0010E9': 'Honeywell', '00900E': 'Honeywell',
  // Poly (Polycom IP phones)
  '0004F2': 'Poly', '64167F': 'Poly', 'C83D97': 'Poly',
  // Cisco IP Phones (7800/8800 series)
  '74A02F': 'Cisco Phone', 'EC1D7F': 'Cisco Phone',
  // Yealink IP phones
  '001565': 'Yealink', '805EC0': 'Yealink', 'DCEF09': 'Yealink',
  // Raspberry Pi Foundation
  'B827EB': 'Raspberry Pi', 'DCA632': 'Raspberry Pi', 'E45F01': 'Raspberry Pi',
};

/** Convert any common MAC format to a 12-char uppercase hex string. */
function stripMac(mac: string): string {
  return mac.replace(/[.:\-]/g, '').toUpperCase();
}

/** Look up the vendor for a MAC address (any common format). Returns null if unknown. */
export function lookupVendor(mac: string): string | null {
  const hex = stripMac(mac).slice(0, 6);
  return OUI[hex] ?? null;
}
