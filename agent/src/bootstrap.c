#include "agent.h"
#include "runtime.h"
#include <openssl/x509v3.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <syslog.h>
#include <sys/stat.h>
#include <openssl/ec.h>
#include <openssl/ecdsa.h>
#include <openssl/obj_mac.h>
#include <openssl/pem.h>
#include <openssl/x509.h>
#include <openssl/x509v3.h>
#include <openssl/sha.h>
#include <openssl/evp.h>
#include "parson.h"

void detect_board_hardware(void) {
    // 1. Try reading /var/xnet_board_info.json (Standard XNET board metadata)
    JSON_Value *val = json_parse_file("/var/xnet_board_info.json");
    if (val) {
        JSON_Object *obj = json_value_get_object(val);
        if (obj) {
            const char *s = json_object_get_string(obj, "serial_number");
            const char *m = json_object_get_string(obj, "mac_address");
            const char *mod = json_object_get_string(obj, "model");
            const char *fw = json_object_get_string(obj, "firmware_version");

            if (s && strlen(s) > 0) strncpy(g_cfg.serial, s, sizeof(g_cfg.serial) - 1);
            if (m && strlen(m) > 0) strncpy(g_cfg.mac_address, m, sizeof(g_cfg.mac_address) - 1);
            if (mod && strlen(mod) > 0) strncpy(g_cfg.model, mod, sizeof(g_cfg.model) - 1);
            if (fw && strlen(fw) > 0) strncpy(g_cfg.firmware_version, fw, sizeof(g_cfg.firmware_version) - 1);
        }
        json_value_free(val);
    }

    // Prefer the configured LAN bridge/device when board metadata has no MAC.
    if (!g_cfg.mac_address[0]) {
        char iface[64]="br-lan";
        struct uci_context *ctx=uci_alloc_context();struct uci_package *pkg=NULL;
        if(ctx && uci_load(ctx,"network",&pkg)==UCI_OK){struct uci_section *lan=uci_lookup_section(ctx,pkg,"lan");
            const char *dev=lan?uci_lookup_option_string(ctx,lan,"device"):NULL;
            const char *type=lan?uci_lookup_option_string(ctx,lan,"type"):NULL;
            if(!dev && (!type||strcmp(type,"bridge")))dev=lan?uci_lookup_option_string(ctx,lan,"ifname"):NULL;
            if(dev&&strlen(dev)<sizeof(iface)&&!strpbrk(dev," /\\\t\n"))snprintf(iface,sizeof(iface),"%s",dev);
        }if(ctx)uci_free_context(ctx);
        char path[128];snprintf(path,sizeof(path),"/sys/class/net/%s/address",iface);FILE *f=fopen(path,"r");
        if(f){if(fgets(g_cfg.mac_address,sizeof(g_cfg.mac_address),f))g_cfg.mac_address[strcspn(g_cfg.mac_address,"\r\n")]=0;fclose(f);}
    }
    // 3. Fallback for Model from /tmp/sysinfo/model
    if (strlen(g_cfg.model) == 0) {
        FILE *f = fopen("/tmp/sysinfo/model", "r");
        if (f) {
            char buf[64];
            if (fgets(buf, sizeof(buf), f)) {
                buf[strcspn(buf, "\r\n")] = 0;
                strncpy(g_cfg.model, buf, sizeof(g_cfg.model) - 1);
            }
            fclose(f);
        } else {
            strncpy(g_cfg.model, "unknown", sizeof(g_cfg.model) - 1);
        }
    }

    // 4. Detect Architecture
    FILE *f_arch = fopen("/etc/openwrt_release", "r");
    if (f_arch) {
        char line[128];
        while (fgets(line, sizeof(line), f_arch)) {
            if (strncmp(line, "DISTRIB_ARCH='", 13) == 0) {
                char *end = strchr(line + 13, '\'');
                if (end) *end = 0;
                strncpy(g_cfg.architecture, line + 13, sizeof(g_cfg.architecture) - 1);
                break;
            }
        }
        fclose(f_arch);
    }
    if (strlen(g_cfg.architecture) == 0) {
        strncpy(g_cfg.architecture, "mips_24kc", sizeof(g_cfg.architecture) - 1);
    }

    // Enrollment must never use a shared demo identity.
    // Use a complete MAC address only when board metadata has no serial.
    if (!g_cfg.serial[0] && strlen(g_cfg.mac_address)==17) {
        snprintf(g_cfg.serial,sizeof(g_cfg.serial),"MAC-%s",g_cfg.mac_address);
    }

    // 7. Fallback for Firmware Version
    if (strlen(g_cfg.firmware_version) == 0) {
        FILE *f_fw = fopen("/etc/openwrt_version", "r");
        if (f_fw) {
            char buf[64];
            if (fgets(buf, sizeof(buf), f_fw)) {
                buf[strcspn(buf, "\r\n")] = 0;
                snprintf(g_cfg.firmware_version, sizeof(g_cfg.firmware_version), "%.63s", buf);
            }
            fclose(f_fw);
        } else {
            strncpy(g_cfg.firmware_version, "unknown", sizeof(g_cfg.firmware_version) - 1);
        }
    }

    rms_random_id(g_cfg.boot_id);

    syslog(LOG_INFO, "Hardware detected: Model=%s (%s), Serial=%s, MAC=%s, BootID=%s",
           g_cfg.model, g_cfg.architecture, g_cfg.serial, g_cfg.mac_address, g_cfg.boot_id);
}

int generate_ec_p256_key_if_missing(void) {
    if (access(RMS_CLIENT_KEY,F_OK)==0) {
        FILE *f=fopen(RMS_CLIENT_KEY,"r");if(!f)return -1;
        EC_KEY *key=PEM_read_ECPrivateKey(f,NULL,NULL,NULL);fclose(f);
        int ok=key && EC_KEY_check_key(key)==1;EC_KEY_free(key);
        return ok?0:-1; /* Never replace a damaged registered identity. */
    }
    if(rms_id(g_cfg.device_id))return -1;
    mkdir(RMS_PKI_DIR,0700);
    EC_KEY *key=EC_KEY_new_by_curve_name(NID_X9_62_prime256v1);if(!key)return -1;
    EC_KEY_set_asn1_flag(key,OPENSSL_EC_NAMED_CURVE);
    BIO *b=BIO_new(BIO_s_mem());int rc=-1;
    if(b && EC_KEY_generate_key(key)==1 && PEM_write_bio_ECPrivateKey(b,key,NULL,NULL,0,NULL,NULL)==1){
        char *data;long n=BIO_get_mem_data(b,&data);rc=rms_write_atomic(RMS_CLIENT_KEY,data,n,0600);
    }
    BIO_free(b);EC_KEY_free(key);return rc;
}

char *generate_csr_pem(void) {
    FILE *fk = fopen(RMS_CLIENT_KEY, "r");
    if (!fk) return NULL;
    EC_KEY *eckey = PEM_read_ECPrivateKey(fk, NULL, NULL, NULL);
    fclose(fk);
    if (!eckey) return NULL;

    EVP_PKEY *pkey = EVP_PKEY_new();
    if (!pkey || !EVP_PKEY_assign_EC_KEY(pkey, eckey)) {
        if (pkey) EVP_PKEY_free(pkey);
        else EC_KEY_free(eckey);
        return NULL;
    }

    X509_REQ *req = X509_REQ_new();
    if (!req) {
        EVP_PKEY_free(pkey);
        return NULL;
    }

    X509_REQ_set_version(req, 0); // PKCS#10 v1

    X509_NAME *name = X509_REQ_get_subject_name(req);
    const char *cn = (strlen(g_cfg.serial) > 0) ? g_cfg.serial : "XNET-ROUTER";
    X509_NAME_add_entry_by_txt(name, "CN", MBSTRING_ASC, (const unsigned char *)cn, -1, -1, 0);

    X509_REQ_set_pubkey(req, pkey);

    if (!X509_REQ_sign(req, pkey, EVP_sha256())) {
        X509_REQ_free(req);
        EVP_PKEY_free(pkey);
        return NULL;
    }

    BIO *bio = BIO_new(BIO_s_mem());
    if (!bio) {
        X509_REQ_free(req);
        EVP_PKEY_free(pkey);
        return NULL;
    }

    PEM_write_bio_X509_REQ(bio, req);

    BUF_MEM *bptr;
    BIO_get_mem_ptr(bio, &bptr);
    char *csr_pem = malloc(bptr->length + 1);
    if (csr_pem) {
        memcpy(csr_pem, bptr->data, bptr->length);
        csr_pem[bptr->length] = '\0';
    }

    BIO_free(bio);
    X509_REQ_free(req);
    EVP_PKEY_free(pkey);
    return csr_pem;
}

char *sign_challenge_message(const char *message) {
    if (!message) return NULL;

    FILE *fk = fopen(RMS_CLIENT_KEY, "r");
    if (!fk) return NULL;
    EC_KEY *eckey = PEM_read_ECPrivateKey(fk, NULL, NULL, NULL);
    fclose(fk);
    if (!eckey) return NULL;

    unsigned char hash[SHA256_DIGEST_LENGTH];
    SHA256((const unsigned char *)message, strlen(message), hash);

    unsigned int sig_len = ECDSA_size(eckey);
    unsigned char *sig = malloc(sig_len);
    if (!sig) {
        EC_KEY_free(eckey);
        return NULL;
    }

    if (!ECDSA_sign(0, hash, SHA256_DIGEST_LENGTH, sig, &sig_len, eckey)) {
        free(sig);
        EC_KEY_free(eckey);
        return NULL;
    }
    EC_KEY_free(eckey);

    // Base64 encode the ASN.1 signature
    int b64_len = 4 * ((sig_len + 2) / 3);
    char *b64 = malloc(b64_len + 1);
    if (b64) {
        int enc_len = EVP_EncodeBlock((unsigned char *)b64, sig, sig_len);
        b64[enc_len] = '\0';
    }
    free(sig);
    return b64;
}


static int install_certificate(const char *text,const char *id) {
    if(!text || !rms_id(id))return -1;
    BIO *b=BIO_new_mem_buf(text,-1);X509 *cert=b?PEM_read_bio_X509(b,NULL,NULL,NULL):NULL;BIO_free(b);
    if(!cert)return -1;
    FILE *f=fopen(RMS_CLIENT_KEY,"r");EVP_PKEY *key=f?PEM_read_PrivateKey(f,NULL,NULL,NULL):NULL;if(f)fclose(f);
    char cn[128]={0};X509_NAME_get_text_by_NID(X509_get_subject_name(cert),NID_commonName,cn,sizeof(cn));
    X509_STORE *store=X509_STORE_new();X509_STORE_CTX *ctx=X509_STORE_CTX_new();
    int ok=key && !strcmp(id,cn) && X509_check_private_key(cert,key)==1 && store && ctx && X509_STORE_load_locations(store,RMS_CA_CRT,NULL)==1 && X509_STORE_CTX_init(ctx,store,cert,NULL)==1;
    if(ok){X509_STORE_CTX_set_purpose(ctx,X509_PURPOSE_SSL_CLIENT);ok=X509_verify_cert(ctx)==1;}
    X509_STORE_CTX_free(ctx);X509_STORE_free(store);EVP_PKEY_free(key);X509_free(cert);
    return ok?rms_write_atomic(RMS_CLIENT_CRT,text,strlen(text),0644):-1;
}
int rms_cert_due(void){
    FILE *f=fopen(RMS_CLIENT_CRT,"r");X509 *x=f?PEM_read_X509(f,NULL,NULL,NULL):NULL;if(f)fclose(f);if(!x)return 2;
    time_t now=time(NULL),renew=now+90*24*3600;
    int due=X509_cmp_time(X509_get0_notAfter(x),&now)<=0?2:X509_cmp_time(X509_get0_notAfter(x),&renew)<=0?1:0;
    if(X509_cmp_time(X509_get0_notBefore(x),&now)>0)due=2;
    X509_free(x);return due;
}
int perform_challenge_recovery(void){
    if(!rms_id(g_cfg.device_id))return -1;
    char url[512];snprintf(url,sizeof(url),"%s/api/v1/provision/challenge",g_cfg.server_url);
    JSON_Value *req=json_value_init_object();json_object_set_string(json_value_get_object(req),"device_id",g_cfg.device_id);
    char *b=json_serialize_to_string(req);json_value_free(req);char *resp=rms_http(url,b,0,8192);free(b);if(!resp)return -1;
    JSON_Value *ch=json_parse_string(resp);free(resp);JSON_Object *o=json_value_get_object(ch);
    const char *message=json_object_get_string(o,"message"),*id=json_object_get_string(o,"challenge_id");
    char prefix[128];snprintf(prefix,sizeof(prefix),"xnet-rms/recovery/v1:%s:",g_cfg.device_id);
    if(!message||strncmp(message,prefix,strlen(prefix))||!rms_id(id)){json_value_free(ch);return -1;}
    char *sig=sign_challenge_message(message);if(!sig){json_value_free(ch);return -1;}
    req=json_value_init_object();o=json_value_get_object(req);json_object_set_string(o,"device_id",g_cfg.device_id);json_object_set_string(o,"challenge_id",id);json_object_set_string(o,"signature",sig);free(sig);json_value_free(ch);
    b=json_serialize_to_string(req);json_value_free(req);snprintf(url,sizeof(url),"%s/api/v1/provision/recover",g_cfg.server_url);resp=rms_http(url,b,0,8192);free(b);if(!resp)return -1;
    req=json_parse_string(resp);free(resp);int rc=install_certificate(json_object_get_string(json_value_get_object(req),"certificate"),g_cfg.device_id);json_value_free(req);return rc;
}
int rms_refresh_certificate(void){
    int due=rms_cert_due();if(due==0)return 0;if(due==2)return perform_challenge_recovery();
    char url[512];snprintf(url,sizeof(url),"%s/api/v1/provision/renew",g_cfg.server_url);char *resp=rms_http(url,"{}",1,8192);if(!resp)return -1;
    JSON_Value *v=json_parse_string(resp);free(resp);int rc=install_certificate(json_object_get_string(json_value_get_object(v),"certificate"),g_cfg.device_id);json_value_free(v);return rc;
}
int perform_provision_checkin(void){
    if(time(NULL)<1577836800){strcpy(rms_http_error,"clock_failure");return -1;}
    if(!g_cfg.serial[0]||strlen(g_cfg.mac_address)!=17){strcpy(rms_http_error,"invalid_identity");return -1;}
    if(generate_ec_p256_key_if_missing()!=0){strcpy(rms_http_error,"identity_key_failure");return -1;}
    if(rms_id(g_cfg.device_id)&&g_cfg.mqtt_host[0])return rms_refresh_certificate();
    char *csr=generate_csr_pem();if(!csr)return -1;
    JSON_Value *v=json_value_init_object();JSON_Object *o=json_value_get_object(v);json_object_set_string(o,"csr",csr);
    char *b=json_serialize_to_string(v);json_value_free(v);char url[256];snprintf(url,sizeof(url),"%s/api/v1/provision/bootstrap/challenge",g_cfg.server_url);
    char *resp=rms_http(url,b,0,8192);free(b);if(!resp){free(csr);return -1;}
    JSON_Value *challenge=json_parse_string(resp);free(resp);JSON_Object *co=json_value_get_object(challenge);
    const char *id=json_object_get_string(co,"challenge_id"),*msg=json_object_get_string(co,"message");char prefix[96];snprintf(prefix,sizeof(prefix),"xnet-rms/bootstrap/v1:%s:",id?id:"");
    if(!rms_id(id)||!msg||strncmp(msg,prefix,strlen(prefix))){free(csr);json_value_free(challenge);return -1;}
    char *sig=sign_challenge_message(msg);if(!sig){free(csr);json_value_free(challenge);return -1;}
    v=json_value_init_object();o=json_value_get_object(v);
    json_object_set_string(o,"serial_number",g_cfg.serial);json_object_set_string(o,"lan_mac",g_cfg.mac_address);json_object_set_string(o,"model",g_cfg.model);json_object_set_string(o,"firmware_version",g_cfg.firmware_version);json_object_set_string(o,"agent_version",AGENT_VERSION);
    json_object_set_string(o,"enrollment_token",g_cfg.enrollment_token);json_object_set_string(o,"csr",csr);json_object_set_string(o,"challenge_id",id);json_object_set_string(o,"signature",sig);
    free(sig);free(csr);json_value_free(challenge);b=json_serialize_to_string(v);json_value_free(v);snprintf(url,sizeof(url),"%s/api/v1/provision/bootstrap/check-in",g_cfg.server_url);resp=rms_http(url,b,0,8192);free(b);if(!resp)return -1;
    v=json_parse_string(resp);free(resp);o=json_value_get_object(v);const char *state=json_object_get_string(o,"registration_state");
    if(state&&strcmp(state,"claimed")){snprintf(rms_http_error,sizeof(rms_http_error),"%s",state);json_value_free(v);return 1;}
    id=json_object_get_string(o,"device_id");const char *cert=json_object_get_string(o,"certificate"),*host=json_object_get_string(o,"mqtt_host"),*org=json_object_get_string(o,"organization_name");int port=json_object_get_number(o,"mqtt_port");
    int rc=-1;if(rms_id(id)&&host&&strlen(host)<sizeof(g_cfg.mqtt_host)&&port>0&&port<=65535&&install_certificate(cert,id)==0){char portstr[8];snprintf(portstr,sizeof(portstr),"%d",port);
        if(save_provisioned_config(id,host,portstr,org?org:"")==0)rc=0;
    }
    json_value_free(v);return rc;
}
