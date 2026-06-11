// Canned Cisco CLI output used by both parser unit tests and the mock SSH device.
// Trimmed real-world samples (IOS-XE Catalyst 9300 + a couple of NX-OS variants).

export const SHOW_VERSION_IOSXE = `Cisco IOS XE Software, Version 17.12.03
Cisco IOS Software [Dublin], Catalyst L3 Switch Software (CAT9K_IOSXE), Version 17.12.3, RELEASE SOFTWARE (fc6)

ROM: IOS-XE ROMMON
BOOTLDR: System Bootstrap, Version 17.12.1r

core-sw-01 uptime is 12 weeks, 3 days, 4 hours, 7 minutes
Uptime for this control processor is 12 weeks, 3 days, 4 hours, 8 minutes
System returned to ROM by Reload Command
System restarted at 09:14:22 UTC Mon Mar 3 2025

cisco C9300-48P (X86) processor with 1331797K/6147K bytes of memory.
Processor board ID FCW2145L0AB
1 Virtual Ethernet interface
52 Gigabit Ethernet interfaces

Model Number                       : C9300-48P
System Serial Number               : FCW2145L0AB
Switch Ports Model              SW Version        SW Image              Mode
------ ----- -----              ----------        --------              ----
*    1 53    C9300-48P          17.12.3           CAT9K_IOSXE           INSTALL
`;

export const SHOW_VERSION_NXOS = `Cisco Nexus Operating System (NX-OS) Software

  BIOS: version 07.69
  NXOS: version 9.3(8)
  BIOS compile time:  03/12/2021

  Device name: dc-leaf-01
  bootflash:   53298520 kB

  Kernel uptime is 45 day(s), 6 hour(s), 51 minute(s), 3 second(s)

  cisco Nexus9000 C93180YC-EX chassis
  Processor board ID FDO20351234
`;

export const SHOW_INTERFACES_STATUS = `Port      Name               Status       Vlan       Duplex  Speed Type
Gi1/0/1   Uplink to core     connected    trunk        full   1000 10/100/1000BaseTX
Gi1/0/2   Printer HR         connected    20         a-full a-1000 10/100/1000BaseTX
Gi1/0/3                      notconnect   1            auto   auto 10/100/1000BaseTX
Gi1/0/4   AP-floor2          connected    10         a-full  a-100 10/100/1000BaseTX
Gi1/0/5   disabled-port      disabled     1            auto   auto 10/100/1000BaseTX
Te1/1/1   Datacenter link    connected    routed       full  10G   SFP-10GBase-SR
`;

export const SHOW_MAC_TABLE = `          Mac Address Table
-------------------------------------------

Vlan    Mac Address       Type        Ports
----    -----------       --------    -----
  10    aabb.cc00.1001    DYNAMIC     Gi1/0/4
  20    aabb.cc00.2002    DYNAMIC     Gi1/0/2
  20    aabb.cc00.2003    STATIC      Gi1/0/2
   1    aabb.cc00.0001    DYNAMIC     Gi1/0/1
Total Mac Addresses for this criterion: 4
`;

export const SHOW_MAC_TABLE_NXOS = `Legend:
        * - primary entry, G - Gateway MAC, (R) - Routed MAC, O - Overlay MAC
   VLAN     MAC Address      Type      age     Secure NTFY Ports
---------+-----------------+--------+---------+------+----+------------------
*   10     aabb.cc00.3001   dynamic   0         F      F    Eth1/3
*   20     aabb.cc00.3002   dynamic   0         F      F    Eth1/4
`;

export const SHOW_POWER_INLINE = `Module   Available     Used     Remaining
          (Watts)     (Watts)    (Watts)
------   ---------   --------   ---------
1           857.0      123.4       733.6
Interface Admin  Oper       Power   Device              Class Max
                            (Watts)
--------- ------ ---------- ------- ------------------- ----- ----
Gi1/0/4   auto   on         15.4    AIR-AP2802I         3     30.0
Gi1/0/2   auto   on         6.5     IP Phone 8841       2     30.0
Gi1/0/3   auto   off        0.0     n/a                 n/a   30.0
`;

export const SHOW_VLAN_BRIEF = `VLAN Name                             Status    Ports
---- -------------------------------- --------- -------------------------------
1    default                          active    Gi1/0/3, Gi1/0/5
10   wifi                             active    Gi1/0/4
20   voice                            active    Gi1/0/2
99   mgmt                             active
`;

export const SHOW_IP_ARP = `Protocol  Address          Age (min)  Hardware Addr   Type   Interface
Internet  10.0.10.50              4   aabb.cc00.1001  ARPA   Vlan10
Internet  10.0.20.25             12   aabb.cc00.2002  ARPA   Vlan20
Internet  10.0.0.1                0   aabb.cc00.0001  ARPA   Vlan1
`;

export const SHOW_CDP_DETAIL = `-------------------------
Device ID: core-rtr-01.corp.local
Entry address(es):
  IP address: 10.0.0.1
Platform: cisco C9500-40X,  Capabilities: Router Switch IGMP
Interface: GigabitEthernet1/0/1,  Port ID (outgoing port): TenGigabitEthernet1/0/24
Holdtime : 145 sec
-------------------------
Device ID: ap-floor2.corp.local
Entry address(es):
  IP address: 10.0.10.5
Platform: cisco AIR-AP2802I-B-K9,  Capabilities: Trans-Bridge
Interface: GigabitEthernet1/0/4,  Port ID (outgoing port): GigabitEthernet0
Holdtime : 130 sec
`;

export const SHOW_PROCESSES_CPU = `CPU utilization for five seconds: 7%/2%; one minute: 9%; five minutes: 11%
`;

export const SHOW_PROCESSES_MEMORY = `Processor Pool Total:  862236672 Used:  204503040 Free:  657733632
`;

export const SHOW_ENV_IOSXE = `SW  PID                 Serial#     Status           Sys Pwr  PoE Pwr  Watts
--  ------------------  ----------  ---------------  -------  -------  -----
1A  PWR-C1-1100WAC      ABC1234567  OK               Good     Good     1100
1B  PWR-C1-1100WAC      ABC7654321  OK               Good     Good     1100

Switch   FAN   Speed   State
------------------------------------
  1       1     8800    OK
  1       2     8800    OK

System Temperature Value: 41 Degree Celsius
`;

// A small running-config used for compliance + git tests.
export const RUNNING_CONFIG_COMPLIANT = `!
hostname core-sw-01
!
aaa new-model
!
enable secret 9 $9$abcdef
service password-encryption
!
ntp server 10.0.0.1
!
tacacs server PRIMARY
 address ipv4 10.0.0.2
!
logging host 10.0.0.5
!
line vty 0 4
 transport input ssh
!
end
`;

export const RUNNING_CONFIG_NONCOMPLIANT = `!
hostname old-sw-02
!
enable password cisco123
!
snmp-server community public RO
!
line vty 0 4
 transport input telnet ssh
!
end
`;
